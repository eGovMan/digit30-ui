# DIGIT 3.0 Help File

**Built by eGovernments Foundation, leveraging the Hugging Face Chat UI framework.**  
*Special thanks to Hugging Face for providing the open-source Chat UI foundation, available at [hf.co/docs/chat-ui](https://huggingface.co/docs/chat-ui/index).*  

![Chat UI repository thumbnail](https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/chatui-websearch.png)

DIGIT 3.0 is a conversational interface designed to enable efficient public service delivery by integrating open-source AI models. It is built as a SvelteKit application, extending the capabilities of the Hugging Face Chat UI to support eGovernments Foundation’s mission of enhancing government service accessibility and efficiency.

## Table of Contents
0. [Quickstart](#quickstart)
1. [No Setup Deploy](#no-setup-deploy)
2. [Setup](#setup)
3. [Launch](#launch)
4. [Web Search](#web-search)
5. [Text Embedding Models](#text-embedding-models)
6. [Extra Parameters](#extra-parameters)
7. [Common Issues](#common-issues)
8. [Deploying to a HF Space](#deploying-to-a-hf-space)
9. [Building](#building)

---

## Quickstart
keycloak must be running on http://localhost:8080
quay.io/keycloak/keycloak:latest

mongo must be running on http://localhost:27017
mongo:latest

To connect to Mongo - use 
'''bash
mongosh "mongodb://localhost:27017"

Also ensure you are running the LLMs. (both can run on 16GB Apple Mac)
Option 1
llama-server --hf-repo Qwen/Qwen2-7B-Instruct-GGUF --hf-file qwen2-7b-instruct-q5_k_m.gguf -c 4096 --port 8082 --n-gpu-layers 20

Option 2
llama-server --hf-repo microsoft/Phi-3-mini-4k-instruct-gguf --hf-file Phi-3-mini-4k-instruct-q4.gguf -c 4096

Ensure DIGIT30 Server has started.

To start DIGIT-UI in dev mode.
'''bash
npm run dev

