FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd --no-create-home --uid 1000 appuser
USER appuser

ENV PORT=8080
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT}
