import { AppServer, AppSession, PhotoData } from '@mentra/sdk';

const PACKAGE_NAME = process.env.PACKAGE_NAME ?? (() => { throw new Error('PACKAGE_NAME is not set in .env file'); })();
const MENTRAOS_API_KEY = process.env.MENTRAOS_API_KEY ?? (() => { throw new Error('MENTRAOS_API_KEY is not set in .env file'); })();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? (() => { throw new Error('OPENAI_API_KEY is not set in .env file'); })();
const ROBOFLOW_WORKFLOW_URL = process.env.ROBOFLOW_WORKFLOW_URL ?? (() => { throw new Error('ROBOFLOW_WORKFLOW_URL is not set in .env file'); })();
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY ?? (() => { throw new Error('ROBOFLOW_API_KEY is not set in .env file'); })();

// Comma-separated list of ElevenLabs voice IDs to cycle through for each detected object
const ELEVENLABS_VOICE_IDS = (process.env.ELEVENLABS_VOICE_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean);

const PORT = parseInt(process.env.PORT || '3000');

const WAKE_WORD = 'awaken';

interface ObjectInfo {
  persona: string;
  voiceId: string;
}

class LumiereApp extends AppServer {
  constructor() {
    super({
      packageName: PACKAGE_NAME,
      apiKey: MENTRAOS_API_KEY,
      port: PORT,
    });
  }

  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    let awakened = false;
    let objects: Record<string, ObjectInfo> = {};
    let nextVoiceIndex = 0;

    session.events.onTranscription(async (data) => {
      if (!data.isFinal) return;

      session.logger.info(`transcribed speech: ${data.text}`)
      const cleanedText = data.text.toLowerCase().replace(/[.,!?;:]/g, '').trim();
      session.logger.info(`cleaned speech: ${cleanedText}`)


      /* ------------------------- Wake-word handling ------------------------ */
      if (cleanedText.includes(WAKE_WORD)) {
        // On every wake-word invocation we reset detected objects and start fresh
        awakened = true;
        objects = {};
        nextVoiceIndex = 0;
        session.audio.speak('Awakening. Hold on while I have a look.');

        /* ------------------------ Capture the photo ------------------------ */
        let dataUrl: string | undefined;
        try {
          const photo: PhotoData = await session.camera.requestPhoto();
          const base64Image = photo.buffer.toString('base64');
          dataUrl = `data:${photo.mimeType};base64,${base64Image}`;
        } catch (err) {
          console.error('Failed to capture photo:', err);
          session.audio.speak("Hmm, I couldn't see anything.");
          return;
        }

        /* ------------------------ Roboflow workflow ------------------------ */
        try {
          const rfResponse = await fetch(ROBOFLOW_WORKFLOW_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${ROBOFLOW_API_KEY}`,
            },
            body: JSON.stringify({ image: dataUrl }),
          });

          if (!rfResponse.ok) {
            throw new Error(`Roboflow request failed: ${rfResponse.status} ${rfResponse.statusText}`);
          }

          // Roboflow returns a simple comma-separated string such as "soda can,water bottle,sunglasses,"
          const rfText = (await rfResponse.text()).trim();
          const detectedObjects = rfText.split(',').map(t => t.trim()).filter(Boolean);
          session.logger.info(`detected objects: ${rfText}`)

          /* --------------- Generate persona + assign voice ID --------------- */
          for (const obj of detectedObjects) {
            if (objects[obj]) continue; // already generated

            // Cycle through provided voice IDs
            const voiceId = ELEVENLABS_VOICE_IDS[nextVoiceIndex % ELEVENLABS_VOICE_IDS.length] || '';
            nextVoiceIndex++;

            let persona = '';
            try {
              const personaResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${OPENAI_API_KEY}`,
                },
                body: JSON.stringify({
                  model: 'gpt-4o-mini',
                  messages: [
                    { role: 'system', content: 'You create fun, eccentric, and short personas for everyday objects, similar to Lumiere and Mrs. Potts from Beauty and the Beast.' },
                    { role: 'user', content: `Give me a persona for a "${obj}" and detail the tone in which the object would speak (ex. shakespearean, hip/hop/modern style, etc).` },
                  ],
                  max_tokens: 50,
                  temperature: 0.9,
                }),
              });
              const personaJson = await personaResponse.json();
              persona = personaJson.choices?.[0]?.message?.content?.trim() ?? '';
            } catch (err) {
              console.error('Error generating persona:', err);
            }

            objects[obj] = { persona, voiceId };
          }

          if (detectedObjects.length === 0) {
            session.audio.speak("I didn't find any interesting objects.");
          } else {
            session.audio.speak('We are ready!');
          }
        } catch (err) {
          console.error('Error calling Roboflow:', err);
          session.audio.speak("Sorry, my eyes aren't working right now.");
        }
        return; // end wake-word branch
      }

      /* --------------------- Conversational branch ---------------------- */
      if (awakened) {
        if (Object.keys(objects).length === 0) {
          session.audio.speak("I don't see anything to talk to yet.");
          return;
        }

        const summaryList = Object.entries(objects)
          .map(([name, info]) => `${name}: ${info.persona}`)
          .join('\n');

        try {
          const replyResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [
                {
                  role: 'system',
                  content: `You are Lumiere, an assistant that makes objects talk.\nHere is the list of objects you can embody with their personas:\n\n${summaryList}\n\nWhen the user speaks, pick the single most likely object they are addressing and respond as that object in first person, staying in character. Return your answer STRICTLY as JSON: {"object":"<object name>", "response":"<what the object says>"}`,
                },
                { role: 'user', content: cleanedText },
              ],
              temperature: 0.8,
              max_tokens: 150,
            }),
          });

          const replyJson = await replyResponse.json();
          const content = replyJson.choices?.[0]?.message?.content ?? '';
          let parsed: { object: string; response: string } = { object: '', response: content };
          try {
            parsed = JSON.parse(content);
          } catch {/* fall back to raw text if parsing fails */}

          const chosen = objects[parsed.object] || Object.values(objects)[0];
          // Currently the Mentra SDK speak method does not expose a voice-selection option, so we simply speak the response.
          session.audio.speak(parsed.response, {
            voice_id: chosen.voiceId, // Uses the voice ID assigned to the selected object
          } as any);
        } catch (err) {
          console.error('Error during chat reply:', err);
          session.audio.speak('Sorry, I got distracted.');
        }
      }
    });
  }
}

/* ------------------------------ Bootstrap ------------------------------ */
const app = new LumiereApp();
app.start().catch(console.error);