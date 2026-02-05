<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1D9KznV1vFBm-1c2HCtBw01afxDqfFI__

## Run Locally (Node + Vite)

**Prerequisites:**  Node.js

1. Install dependencies: `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app em modo dev: `npm run dev`

## Rodar com Python Flask (build estático)

**Pré-requisitos:** Python 3.10+ e Node.js para gerar o build.

1. Instale dependências JS: `npm install`
2. Crie o build estático: `npm run build` (gera a pasta `dist/`)
3. Instale dependências Python: `pip install -r requirements.txt`
4. Defina a chave em runtime (ex.: `export GEMINI_API_KEY=...`)
5. Rode o servidor: `flask --app app run --port 5000`

O Flask serve os arquivos de `dist/` e expõe `/config.json` com `apiKey` lida de `GEMINI_API_KEY` (ou `API_KEY`).
