import { AppServer, AppSession, PhotoData } from '@mentra/sdk';
import RunwayML from '@runwayml/sdk';


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

    session.events.onButtonPress(async (button) => {
      session.logger.info("Button pressed");

      // if long button press:
      if (button.pressType === 'long') {
        const client = new RunwayML();
        let dataUrl: string | undefined;
        let base64Image: string | undefined;
        try {
          const photo: PhotoData = await session.camera.requestPhoto();
          base64Image = photo.buffer.toString('base64');
          dataUrl = `data:${photo.mimeType};base64,${base64Image}`;
        } catch (err) {
          console.error('Failed to capture photo:', err);
          session.audio.speak("Hmm, I couldn't see anything.");
          return;
        }
        const task = await client.imageToVideo
        .create({
          model: 'gen4_turbo',
          promptImage: dataUrl,
          promptText: 'The object comes alive. On the front of the object, two large, adorable cartoonish eyes appear—slightly exaggerated for cuteness, with a glossy, animated shine and long, expressive blinks. The eyes look around curiously, sometimes widening in surprise or narrowing in playful focus. The object wobbles gently in place, occasionally doing a tiny hop, tilt, or spin as if reacting with childlike curiosity. Its movements are full of charm, like a small animated character exploring its environment. The entire scene is looped, with the object blinking, shifting, rocking, and glancing around. Lighting and reflections on the object remain realistic, with soft shadows enhancing its lifelike appearance.',
          ratio: '1280:720',
        })
        .waitForTaskOutput();
      
        console.log(task);
      }
      else {

        // On every wake-word invocation we reset detected objects and start fresh
        awakened = true;
        objects = {};
        nextVoiceIndex = 0;
        session.audio.speak('Awakening. Hold on while I have a look.');

        /* ------------------------ Capture the photo ------------------------ */
        let dataUrl: string | undefined;
        let base64Image: string | undefined;
        try {
          const photo: PhotoData = await session.camera.requestPhoto();
          base64Image = photo.buffer.toString('base64');
          dataUrl = `data:${photo.mimeType};base64,${base64Image}`;
        } catch (err) {
          console.error('Failed to capture photo:', err);
          session.audio.speak("Hmm, I couldn't see anything.");
          return;
        }

        /* ------------------------ Roboflow workflow ------------------------ */
        try {
          // const rfResponse = await fetch(ROBOFLOW_WORKFLOW_URL, {
          //   method: 'POST',
          //   headers: {
          //     'Content-Type': 'application/json',
          //   },
          //   body: JSON.stringify({
          //     api_key: `${ROBOFLOW_API_KEY}`,
          //     inputs: {
          //         "image": {"type": "base64", "value": `${base64Image}`}
          //     }
          // })
          // });
          const rfResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: 'You are a reliable and trustworthy object detector.' },
                { 
                  role: 'user',  
                  content: [
                    { type: "text", text: `Detect all of the 'major' objects from the input image. A 'major' object would be one that you believe would be able to talk if we were in Beauty and the Beast (e.g. Lumiere, Mrs. Potts, etc.). Return a single string of all of the major objects, separated by just commas. Example: 'soda can,water bottle,sunglasses,phone,'. Output only in that format and nothing else.`},
                    ...(dataUrl ? [{ type: "image_url", image_url: { url: dataUrl } }] : [])
                  ]
                }
              ],
              temperature: 0.3,
            }),
          });

          // if (!rfResponse.ok) {
          //   throw new Error(`Roboflow request failed: ${rfResponse.status} ${rfResponse.statusText}`);
          // }

          // Roboflow returns a simple comma-separated string such as "soda can,water bottle,sunglasses,"
          const rfJson = await rfResponse.json();
          const rfText = (rfJson.choices?.[0]?.message?.content ?? '').trim();
          const detectedObjects = rfText.split(',').map(t => t.trim()).filter(Boolean);
          session.logger.info(`detected objects: ${detectedObjects}`)

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
    });

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
        let base64Image: string | undefined;
        try {
          const photo: PhotoData = await session.camera.requestPhoto();
          base64Image = photo.buffer.toString('base64');
          dataUrl = `data:${photo.mimeType};base64,${base64Image}`;
        } catch (err) {
          console.error('Failed to capture photo:', err);
          session.audio.speak("Hmm, I couldn't see anything.");
          return;
        }

        /* ------------------------ Roboflow workflow ------------------------ */
        try {
          // const rfResponse = await fetch(ROBOFLOW_WORKFLOW_URL, {
          //   method: 'POST',
          //   headers: {
          //     'Content-Type': 'application/json',
          //   },
          //   body: JSON.stringify({
          //     api_key: `${ROBOFLOW_API_KEY}`,
          //     inputs: {
          //         "image": {"type": "base64", "value": `${base64Image}`}
          //     }
          // })
          // });
          const rfResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: 'You are a reliable and trustworthy object detector.' },
                { 
                  role: 'user',  
                  content: [
                    { type: "text", text: `Detect all of the 'major' objects from the input image. A 'major' object would be one that you believe would be able to talk if we were in Beauty and the Beast (e.g. Lumiere, Mrs. Potts, etc.). Return a single string of all of the major objects, separated by just commas. Example: 'soda can,water bottle,sunglasses,phone,'. Output only in that format and nothing else.`},
                    ...(dataUrl ? [{ type: "image_url", image_url: { url: dataUrl } }] : [])
                  ]
                }
              ],
              temperature: 0.3,
            }),
          });

          // if (!rfResponse.ok) {
          //   throw new Error(`Roboflow request failed: ${rfResponse.status} ${rfResponse.statusText}`);
          // }

          // Roboflow returns a simple comma-separated string such as "soda can,water bottle,sunglasses,"
          const rfJson = await rfResponse.json();
          const rfText = (rfJson.choices?.[0]?.message?.content ?? '').trim();
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

    // session.events.onButtonPress(async (button) => {
    //   const client = new RunwayML();
    //   let dataUrl: string | undefined;
    //   let base64Image: string | undefined;
    //   try {
    //     const photo: PhotoData = await session.camera.requestPhoto();
    //     base64Image = photo.buffer.toString('base64');
    //     dataUrl = `data:${photo.mimeType};base64,${base64Image}`;
    //   } catch (err) {
    //     console.error('Failed to capture photo:', err);
    //     session.audio.speak("Hmm, I couldn't see anything.");
    //     return;
    //   }
    //   const task = await client.imageToVideo
    //   .create({
    //     model: 'gen4_turbo',
    //     promptImage: dataUrl,
    //     promptText: 'The object comes alive. On the front of the can, two large, adorable cartoonish eyes appear—slightly exaggerated for cuteness, with a glossy, animated shine and long, expressive blinks. The eyes look around curiously, sometimes widening in surprise or narrowing in playful focus. The can wobbles gently in place, occasionally doing a tiny hop, tilt, or spin as if reacting with childlike curiosity. Its movements are full of charm, like a small animated character exploring its environment. The entire scene is looped, with the can blinking, shifting, rocking, and glancing around. Lighting and reflections on the can remain realistic, with soft shadows enhancing its lifelike appearance.',
    //     ratio: '1280:720',
    //   })
    //   .waitForTaskOutput();
    
    // console.log(task);
    // });

  }
}

/* ------------------------------ Bootstrap ------------------------------ */
const app = new LumiereApp();
app.start().catch(console.error);