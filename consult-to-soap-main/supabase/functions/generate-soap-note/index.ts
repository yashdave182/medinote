import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { transcript, patientName } = await req.json()
    
    if (!transcript) {
      throw new Error('No transcript provided')
    }

    console.log('Generating SOAP note for transcript...');

    const systemPrompt = `You are a medical AI assistant specialized in creating structured SOAP (Subjective, Objective, Assessment, Plan) notes from doctor-patient conversation transcripts.

Your task is to:
1. Extract and organize information into SOAP format
2. Identify medical entities (symptoms, medications, conditions, etc.)
3. Use proper medical terminology
4. Be concise but comprehensive
5. Only include information that is explicitly mentioned in the transcript

Format your response as a JSON object with the following structure:
{
  "subjective": "Patient's reported symptoms, concerns, and history",
  "objective": "Observable findings, vital signs, examination results",
  "assessment": "Clinical impression and diagnosis",
  "plan": "Treatment plan, medications, follow-up",
  "extracted_entities": {
    "symptoms": ["list of symptoms mentioned"],
    "medications": ["list of medications mentioned"],
    "conditions": ["list of medical conditions mentioned"],
    "duration": ["timeframes mentioned"],
    "severity": ["severity indicators mentioned"]
  }
}

Important guidelines:
- Only include information explicitly stated in the transcript
- Use "Not mentioned" or leave empty if no relevant information is found
- Maintain patient confidentiality
- Use professional medical language
- Be accurate and avoid assumptions`;

    const userPrompt = `Please create a SOAP note from the following medical consultation transcript for patient ${patientName || 'Patient'}:

TRANSCRIPT:
${transcript}

Please provide a structured SOAP note in JSON format.`;

    // Send to OpenAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 2000,
        temperature: 0.3,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', errorText);
      throw new Error(`OpenAI API error: ${errorText}`)
    }

    const result = await response.json()
    console.log('SOAP note generation completed successfully');

    try {
      // Parse the JSON response from GPT
      const soapNote = JSON.parse(result.choices[0].message.content);
      
      return new Response(
        JSON.stringify(soapNote),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } catch (parseError) {
      console.error('Failed to parse SOAP note JSON:', parseError);
      // Fallback: return the raw content
      return new Response(
        JSON.stringify({
          subjective: result.choices[0].message.content,
          objective: "Unable to parse structured data",
          assessment: "Unable to parse structured data", 
          plan: "Unable to parse structured data",
          extracted_entities: {}
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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