# CPU image. Also works as a Hugging Face Docker Space (port 7860).
FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY sibr_api ./sibr_api
ENV PORT=7860 HF_HOME=/tmp/hf
EXPOSE 7860
CMD uvicorn sibr_api.app:app --host 0.0.0.0 --port ${PORT}
