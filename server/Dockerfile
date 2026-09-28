FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --timeout 60 --retries 10 -r requirements.txt

COPY . .

RUN useradd --no-create-home --uid 1000 appuser
USER appuser

ENV PORT=8080
# --no-access-log：Cloud Run 本身已經記錄每個請求，uvicorn 再印一次只是重複寫 Cloud Logging。
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT} --no-access-log
