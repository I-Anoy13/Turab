
import { GoogleGenAI } from "@google/genai";

// Initialize the Google GenAI client correctly with the API key from environment variables.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const getGameCommentary = async (
  event: string, 
  gameState: any
): Promise<string> => {
  if (!process.env.API_KEY) return "The dealer watches the game intently.";

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `You are a professional card game commentator for a game called "Trump Master".
      Rules: 4 players, must follow lead suit. If you can't follow, you announce Trump. 
      Winning the pile requires TWO CONSECUTIVE wins.
      
      Context: ${event}
      Current Pile Size: ${gameState.pile.length}
      Trump Suit: ${gameState.trumpSuit || 'Not yet announced'}
      Last Trick Winner: ${gameState.lastWinner !== null ? gameState.players[gameState.lastWinner].name : 'None'}
      
      Generate a short, punchy, witty one-sentence commentary for this event. 
      Keep it high energy and focused on the drama of the "two consecutive wins" rule.`,
      config: {
        temperature: 0.8,
        topP: 0.9,
      }
    });

    // Access the generated text using the .text property as per guidelines.
    return response.text?.trim() || "What a play!";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "The table goes silent as the tension rises.";
  }
};
