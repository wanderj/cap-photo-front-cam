# Secure Local Camera Capture (HTML5 + FastAPI)

Aplicacao local para captura de imagem da camera frontal com consentimento explicito, envio confirmado e armazenamento seguro em disco.

## Caracteristicas

- Frontend puro em HTML5 + JavaScript (sem frameworks pesados).
- Fluxo automatico no carregamento da pagina com consentimento claro do navegador.
- Captura via `getUserMedia` com `facingMode: user` sem clique manual.
- Sem preview de stream de camera; placeholder visual estatico exibido em tela.
- Captura e envio automaticos apos permissao concedida.
- Encerramento de tracks apos captura para reduzir exposicao da camera.
- Backend em FastAPI com:
  - upload multipart/form-data,
  - limite de 8MB,
  - validacao de JPEG (MIME + assinatura basica),
  - identificacao de IP no backend,
  - criacao automatica de `./uploads`,
  - log de metadados em JSONL.

## Estrutura de diretorios

```text
.
├── backend/
│   └── main.py
├── frontend/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── openspec/
│   └── ...
├── requirements.txt
├── .gitignore
└── README.md
```

Arquivos gerados em runtime:

```text
uploads/
├── <timestamp>_<ip>.jpg
└── metadata.jsonl
```

## Requisitos

- Python 3.11+
- Navegador moderno com suporte a camera (`getUserMedia`)

## Execucao local passo a passo

1. Criar e ativar ambiente virtual:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

2. Instalar dependencias:

```bash
pip install -r requirements.txt
```

3. Iniciar backend FastAPI em localhost:

```bash
uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

4. Em outro terminal, servir frontend estatico localmente:

```bash
python3 -m http.server 5500 -d frontend
```

5. Abrir no navegador:

```text
http://127.0.0.1:5500
```

## Endpoints

- `GET /health`: status simples da API.
- `POST /upload`: recebe imagem JPEG via multipart e salva em `uploads/`.

## Exemplo curl (multipart/form-data)

```bash
curl -X POST "http://127.0.0.1:8000/upload" \
  -H "User-Agent: curl-test" \
  -F "image=@./sample.jpg;type=image/jpeg" \
  -F "user_agent=Mozilla/5.0 (curl example)"
```

## Exemplo fetch (frontend)

```javascript
const formData = new FormData();
formData.append("image", jpegBlob, "capture.jpg");
formData.append("user_agent", navigator.userAgent || "");

const response = await fetch("http://127.0.0.1:8000/upload", {
  method: "POST",
  body: formData,
});

const result = await response.json();
console.log(result);
```

## Fluxo automatico no frontend

1. Pagina carrega e inicia automaticamente `initCamera()` no `DOMContentLoaded`.
2. Browser solicita permissao de camera.
3. Se concedida, o frontend captura um frame com `captureFrame()`.
4. Stream e encerrada com `track.stop()`.
5. Imagem e enviada com `sendImage()` para `POST /upload`.

Tratamento de erros implementado:

- Permissao negada (`NotAllowedError`).
- Timeout de decisao de permissao.
- Falha de dispositivo (`NotFoundError`, `NotReadableError` e fallback generico).

## Privacidade e seguranca

- Consentimento exibido antes da captura.
- Sem tentativa de captura de IP no frontend.
- IP obtido no backend a partir da requisicao HTTP.
- Limite de upload em 8MB.
- Validacao de tipo de conteudo e assinatura JPEG.
- Sanitizacao de IP para composicao de nome de arquivo.
- Superficie minima de API (somente `health` e `upload`).
- Recomendacao: manter API bindada em `127.0.0.1` no ambiente local.

## Validacao funcional local (manual)

Checklist executavel:

- [x] Fluxo feliz: consentimento -> iniciar camera -> capturar -> confirmar -> upload salvo.
- [x] Sem preview: apos captura, nenhuma miniatura/imagem exibida.
- [x] Erro de permissao: negar camera e validar mensagem no frontend.
- [x] Erro de tipo invalido: enviar arquivo nao JPEG e validar resposta 415.
- [x] Erro de tamanho: enviar payload > 8MB e validar resposta 413.

Resultados de validacao executada nesta sessao:

```text
Data: 2026-05-06
Ambiente: Linux local, Python 3, FastAPI em 127.0.0.1:8000, frontend em 127.0.0.1:5500
Health check: 200 OK
Upload JPEG valido: 200 OK, arquivo persistido com nome <timestamp>_127.0.0.1.jpg
Arquivo invalido (text/plain): 415 Unsupported Media Type
Payload vazio: 422 Unprocessable Entity
Payload >8MB: 413 Content Too Large
Permissao negada (navegador headless): mensagem de erro em vermelho exibida corretamente no frontend
Sem preview: confirmado visualmente via screenshot do navegador
Metadata JSONL: registros acumulados corretamente apos cada upload aceito
```
