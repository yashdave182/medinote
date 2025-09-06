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

    // Attempt to generate content; if the model isn't supported for generateContent
    // (404 model not found), list available models and retry with a fallback.
    let result;
    try {
      result = await model.generateContent([
        SYSTEM_PROMPT,
        `Process this medical consultation transcript into SOAP format and extract medical terms: ${transcript}`
      ]);
    } catch (genErr) {
      console.warn('generateContent failed on initial model:', genErr?.message ?? genErr);
      const msg = (genErr?.message || '').toString();
      const isModelNotFound = msg.includes('models/gemini-pro') || msg.includes('model is not found') || msg.includes('404');
      if (!isModelNotFound) {
        throw genErr;
      }

      // Try to discover an alternative model via listModels
      if (!genAI.listModels) {
        throw new Error('[GoogleGenerativeAI Error] initial generateContent failed and listModels is not available');
      }

      const available = await genAI.listModels();
      // available might be an array or an object with models property
  // Use `any` to avoid strict typing issues in this small runtime helper.
  let modelsArr: any[] = [];
  if (Array.isArray(available)) modelsArr = available as any[];
  else if (available?.models && Array.isArray(available.models)) modelsArr = available.models as any[];

  // Prefer models with 'gemini' or 'bison' in the name, otherwise pick first.
  const pick: any = modelsArr.find((m: any) => ((m.name || m.id || m.model || '') + '').toLowerCase().includes('gemini'))
        || modelsArr.find((m: any) => ((m.name || m.id || m.model || '') + '').toLowerCase().includes('bison'))
        || modelsArr[0];

  const fallbackName = pick ? (pick.name || pick.id || pick.model || pick) : null;
      if (!fallbackName) {
        throw new Error('[GoogleGenerativeAI Error] no fallback model available from listModels');
      }

      console.log('Retrying generateContent with fallback model:', fallbackName);
      const fallbackModel = genAI.getGenerativeModel({ model: fallbackName });
      result = await fallbackModel.generateContent([
        SYSTEM_PROMPT,
        `Process this medical consultation transcript into SOAP format and extract medical terms: ${transcript}`
      ]);
    }

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