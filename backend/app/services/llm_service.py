import os
import json
import requests
from typing import List
from app.schemas.document import DocumentChunk
from app.schemas.graph import GraphExtractionResponse, ExtractedConcept, PrerequisiteRelation

class LLMExtractionService:
    def __init__(self):
        self.api_key = os.getenv("OPENROUTER_API_KEY")
        self.openrouter_url = "https://openrouter.ai/api/v1/chat/completions"
        # DeepSeek V3 / R1 models on OpenRouter
        self.model = os.getenv("OPENROUTER_MODEL", "deepseek/deepseek-v4-flash-0731")

    def extract_graph_from_chunks(self, chunks: List[DocumentChunk], filename: str) -> GraphExtractionResponse:
        """Sends slide chunks to DeepSeek via OpenRouter API and parses validated Knowledge Graphs."""
        if not self.api_key:
            print("[LLM Service] OPENROUTER_API_KEY not found. Using fallback mock extraction.")
            return self._mock_fallback_extraction(filename)

        # Combine text chunks into formatted slide prompt
        combined_text = "\n\n".join(
            [f"--- Slide {c.page_number} ---\n{c.content}" for c in chunks if c.content and c.content.strip()]
        )

        system_prompt = (
            "You are an expert academic knowledge graph extractor. "
            "Analyze the provided lecture slide content and extract core educational concepts "
            "and direct prerequisite relationships (PREREQUISITE_OF).\n\n"
            "Extraction Rules:\n"
            "1. Concept IDs must be lowercase snake_case (e.g., hill_climbing_search).\n"
            "2. Only extract explicit prerequisite dependencies where Concept A is necessary to understand Concept B.\n"
            "3. Provide brief 1-sentence reasoning for each prerequisite link."
        )

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/YOUR_GITHUB_USERNAME/educational-kg-platform", # Optional for OpenRouter ranking
            "X-Title": "Educational Knowledge Graph Platform"
        }

        # Generate JSON Schema directly from Pydantic model
        json_schema = GraphExtractionResponse.model_json_schema()

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Extract Knowledge Graph from document '{filename}':\n\n{combined_text}"}
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "graph_extraction_response",
                    "strict": True,
                    "schema": json_schema
                }
            },
            "temperature": 0.0
        }

        try:
            response = requests.post(
                url=self.openrouter_url,
                headers=headers,
                data=json.dumps(payload),
                timeout=60
            )
            response.raise_for_status()
            
            res_json = response.json()
            message_content = res_json['choices'][0]['message']['content']

            # Parse returned JSON into Pydantic model
            parsed_data = json.loads(message_content)
            return GraphExtractionResponse(**parsed_data)

        except Exception as e:
            print(f"[LLM Extraction Error - OpenRouter/DeepSeek]: {e}")
            return self._mock_fallback_extraction(filename)

    def _mock_fallback_extraction(self, filename: str) -> GraphExtractionResponse:
        """Deterministic fallback if OpenRouter API call fails or key is missing."""
        return GraphExtractionResponse(
            concepts=[
                ExtractedConcept(concept_id="state_space", name="State Space", description="Set of all valid configurations in a search problem."),
                ExtractedConcept(concept_id="local_search", name="Local Search", description="Iterative optimization operating on a single current state."),
                ExtractedConcept(concept_id="hill_climbing", name="Hill-Climbing Search", description="Greedy local search moving continuously in direction of increasing value.")
            ],
            relationships=[
                PrerequisiteRelation(source_concept_id="state_space", target_concept_id="local_search", reasoning="State space definition is required before searching states."),
                PrerequisiteRelation(source_concept_id="local_search", target_concept_id="hill_climbing", reasoning="Hill climbing is a specific local search algorithm variant.")
            ]
        )