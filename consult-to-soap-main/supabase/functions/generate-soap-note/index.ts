import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@^0.1.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SYSTEM_PROMPT = `You are a medical scribe assistant. Your task is to:
1. Convert the raw transcription into a structured SOAP note format
2. Extract medical terms and their brief definitions
3. Ensure medical accuracy and proper formatting

Format the response as JSON with the following structure:
{
  "soap": {
    "subjective": "Patient's symptoms, complaints, and history",
    "objective": "Physical examination findings and vital signs",
    "assessment": "Diagnosis and clinical impressions",
    "plan": "Treatment plan, medications, and follow-up"
  },
  "medicalTerms": [
    {
      "term": "medical term",
      "definition": "brief definition",
      "category": "symptom|diagnosis|medication|procedure"
    }
  ]
}`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { transcript } = await req.json();
    if (!transcript) {
      throw new Error('transcript is required');
    }

    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }

    console.log('Generating SOAP note using Gemini...');
    const genAI = new GoogleGenerativeAI(geminiApiKey);

    // Try preferred model first, fall back to listing available models if it's not found.
    let model;
    try {
      model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    } catch (err) {
      console.warn('Preferred model gemini-pro not available, attempting to list available models', err?.message ?? err);
      try {
        // NOTE: assuming the client exposes a listModels() method that returns an array of models.
        const available = await genAI.listModels?.();
        const first = Array.isArray(available) && available.length ? (available[0].name || available[0].id || available[0].model || available[0]) : null;
        if (!first) {
          throw new Error('no available models returned from listModels');
        }
        console.log('Falling back to model:', first);
        model = genAI.getGenerativeModel({ model: first });
      } catch (err2) {
        // Surface a clearer error that the function can return to the caller
        throw new Error(`[GoogleGenerativeAI Error] model selection failed: ${err2?.message ?? err2}`);
      }
    }

    const result = await model.generateContent([
      SYSTEM_PROMPT,
      `Process this medical consultation transcript into SOAP format and extract medical terms: ${transcript}`
    ]);

    const response = result.response;
    const processedText = response.text();
    
    // Parse the JSON response
    const parsedResponse = JSON.parse(processedText);

    return new Response(
      JSON.stringify(parsedResponse),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('SOAP note generation error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})