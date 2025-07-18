#!/usr/bin/env node
"use strict";
/**
 * Generate a 5-second 1280×720 clip with Gen-4 Turbo,
 * reading the API key from environment variables or .env file.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("fs/promises"));
const dotenv_1 = require("dotenv");
// Load environment variables from .env file
(0, dotenv_1.config)();
// Configuration
const IMAGE_PATH = "starter_frame.jpg";
const PROMPT_TEXT = `
The object comes alive. On the front of the can, two large, adorable cartoonish eyes appear—slightly exaggerated for cuteness, with a glossy, animated shine and long, expressive blinks. The eyes look around curiously, sometimes widening in surprise or narrowing in playful focus. The can wobbles gently in place, occasionally doing a tiny hop, tilt, or spin as if reacting with childlike curiosity. Its movements are full of charm, like a small animated character exploring its environment. The entire scene is looped, with the can blinking, shifting, rocking, and glancing around. Lighting and reflections on the can remain realistic, with soft shadows enhancing its lifelike appearance.
`.trim();
const OUT_PATH = "output.mp4";
const RATIO = "1280:720";
const DURATION = 5;
async function toDataUri(imagePath) {
    try {
        const imageBuffer = await promises_1.default.readFile(imagePath);
        const base64 = imageBuffer.toString('base64');
        const ext = imagePath.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
        return `data:image/${ext};base64,${base64}`;
    }
    catch (error) {
        throw new Error(`Failed to read image file: ${error}`);
    }
}
async function startVideoGeneration(imageData, apiKey) {
    const requestBody = {
        promptImage: imageData,
        seed: Math.floor(Math.random() * 1000000000),
        model: "gen4_turbo",
        promptText: PROMPT_TEXT,
        duration: DURATION,
        ratio: RATIO,
    };
    console.log("=== VIDEO GENERATION REQUEST ===");
    console.log("URL: https://api.dev.runwayml.com/v1/image_to_video");
    console.log("Method: POST");
    console.log("Headers:", {
        "Authorization": `Bearer ${apiKey.substring(0, 10)}...`,
        "X-Runway-Version": "2024-11-06",
        "Content-Type": "application/json",
    });
    console.log("Request body:", {
        ...requestBody,
        promptImage: requestBody.promptImage.substring(0, 50) + "...[truncated]"
    });
    const response = await fetch("https://api.dev.runwayml.com/v1/image_to_video", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "X-Runway-Version": "2024-11-06",
            "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
    });
    const result = await response.json();
    console.log("=== VIDEO GENERATION RESPONSE ===");
    console.log("Status:", response.status, response.statusText);
    console.log("Response headers:", Object.fromEntries(response.headers.entries()));
    console.log("Response body:", JSON.stringify(result, null, 2));
    // Save response to file for debugging
    await promises_1.default.writeFile('start_generation_response.json', JSON.stringify({
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: result
    }, null, 2));
    if (!response.ok) {
        console.error("ERROR: Video generation request failed");
        throw new Error(result.message || 'Failed to start video generation');
    }
    console.log(`✓ Task created successfully with ID: ${result.id}`);
    return result.id;
}
async function pollForCompletion(taskId, apiKey) {
    let pollCount = 0;
    const allResponses = [];
    while (true) {
        pollCount++;
        console.log(`\n=== POLLING ATTEMPT #${pollCount} ===`);
        console.log("URL:", `https://api.dev.runwayml.com/v1/tasks/${taskId}`);
        console.log("Method: GET");
        console.log("Headers:", {
            "Authorization": `Bearer ${apiKey.substring(0, 10)}...`,
            "X-Runway-Version": "2024-11-06",
        });
        const response = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "X-Runway-Version": "2024-11-06",
            },
        });
        const result = await response.json();
        console.log("=== POLLING RESPONSE ===");
        console.log("Status:", response.status, response.statusText);
        console.log("Response headers:", Object.fromEntries(response.headers.entries()));
        console.log("Response body:", JSON.stringify(result, null, 2));
        // Save this poll response
        const pollResponse = {
            pollCount,
            timestamp: new Date().toISOString(),
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: result
        };
        allResponses.push(pollResponse);
        // Save all polling responses to file
        await promises_1.default.writeFile('polling_responses.json', JSON.stringify(allResponses, null, 2));
        if (!response.ok) {
            console.error("ERROR: Polling request failed");
            throw new Error(result.message || 'Failed to check task status');
        }
        if (result.status === 'SUCCEEDED') {
            if (!result.output || result.output.length === 0) {
                console.error("ERROR: No output URL returned from successful task");
                throw new Error('No output URL returned from successful task');
            }
            console.log(`✓ Video generation completed successfully!`);
            console.log(`✓ Video URL: ${result.output[0]}`);
            return result.output[0];
        }
        else if (result.status === 'FAILED') {
            console.error("ERROR: Video generation failed");
            throw new Error('Video generation failed');
        }
        else {
            console.log(`⏳ Task status: ${result.status}, waiting 2 seconds before next poll...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}
async function downloadVideo(videoUrl, outputPath) {
    console.log("\n=== VIDEO DOWNLOAD ===");
    console.log("Downloading video from:", videoUrl);
    console.log("Saving to:", outputPath);
    const response = await fetch(videoUrl);
    console.log("Download response status:", response.status, response.statusText);
    console.log("Download response headers:", Object.fromEntries(response.headers.entries()));
    if (!response.ok) {
        console.error("ERROR: Failed to download video");
        throw new Error(`Failed to download video: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    console.log(`Downloaded ${buffer.byteLength} bytes`);
    await promises_1.default.writeFile(outputPath, new Uint8Array(buffer));
    console.log(`✓ Video saved successfully to ${outputPath}`);
    // Log file stats
    try {
        const stats = await promises_1.default.stat(outputPath);
        console.log(`✓ File size: ${stats.size} bytes (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    }
    catch (error) {
        console.log("Could not get file stats:", error);
    }
}
async function main() {
    const startTime = Date.now();
    console.log("=".repeat(50));
    console.log("🎬 RUNWAY VIDEO GENERATION SCRIPT");
    console.log("=".repeat(50));
    console.log("Start time:", new Date().toISOString());
    console.log("Configuration:");
    console.log("  - Image:", IMAGE_PATH);
    console.log("  - Output:", OUT_PATH);
    console.log("  - Ratio:", RATIO);
    console.log("  - Duration:", DURATION, "seconds");
    console.log("  - Model: gen4_turbo");
    console.log("=".repeat(50));
    try {
        // Get API key from environment
        const apiKey = process.env.RUNWAYML_API_SECRET || process.env.RUNWAY_API_KEY;
        if (!apiKey) {
            console.error("ERROR: API key not found");
            throw new Error('API key not found. Please set RUNWAYML_API_SECRET or RUNWAY_API_KEY environment variable, ' +
                'or add it to a .env file in the current directory.');
        }
        console.log("✓ API key found (length:", apiKey.length, "characters)");
        console.log("\n📖 Reading image...");
        // Convert image to data URI or use URL if it's already a URL
        const imageData = IMAGE_PATH.startsWith('http')
            ? IMAGE_PATH
            : await toDataUri(IMAGE_PATH);
        console.log("✓ Image processed, data URI length:", imageData.length, "characters");
        console.log("\n🚀 Starting video generation...");
        // Start video generation
        const taskId = await startVideoGeneration(imageData, apiKey);
        // Poll for completion
        console.log("\n⏳ Polling for completion...");
        const videoUrl = await pollForCompletion(taskId, apiKey);
        // Download the video
        await downloadVideo(videoUrl, OUT_PATH);
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        console.log("\n" + "=".repeat(50));
        console.log("🎉 GENERATION COMPLETE!");
        console.log("=".repeat(50));
        console.log("Total time:", duration.toFixed(2), "seconds");
        console.log("Video URL:", videoUrl);
        console.log("Saved to:", OUT_PATH);
        console.log("Debug files created:");
        console.log("  - start_generation_response.json");
        console.log("  - polling_responses.json");
        console.log("=".repeat(50));
    }
    catch (error) {
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        console.log("\n" + "=".repeat(50));
        console.error("❌ GENERATION FAILED");
        console.log("=".repeat(50));
        console.error("Error:", error instanceof Error ? error.message : error);
        console.error("Failed after:", duration.toFixed(2), "seconds");
        console.log("Check debug files for API responses:");
        console.log("  - start_generation_response.json (if created)");
        console.log("  - polling_responses.json (if created)");
        console.log("=".repeat(50));
        // Try to save error details
        try {
            await promises_1.default.writeFile('error_log.json', JSON.stringify({
                timestamp: new Date().toISOString(),
                duration: duration,
                error: error instanceof Error ? {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                } : error
            }, null, 2));
            console.log("Error details saved to error_log.json");
        }
        catch (writeError) {
            console.log("Could not save error log:", writeError);
        }
        process.exit(1);
    }
}
// Run the script
if (require.main === module) {
    main();
}
