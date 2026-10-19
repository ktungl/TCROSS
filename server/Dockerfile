FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --timeout 60 --retries 10 -r requirements.txt

# AI 報告 PDF／圖表用的中文字型（Noto Sans TC，SIL OFL），建置時下載並核對 SHA-256，見 fetch_fonts.py。
ENV REPORT_FONT_DIR=/usr/share/fonts/noto-tc
COPY fetch_fonts.py .
RUN python fetch_fonts.py

COPY . .

RUN useradd --no-create-home --uid 1000 appuser
USER appuser

# appuser 沒有家目錄，matplotlib 的字型快取改放 /tmp
ENV MPLCONFIGDIR=/tmp/matplotlib

ENV PORT=8080
# --no-access-log：Cloud Run 本身已經記錄每個請求，uvicorn 再印一次只是重複寫 Cloud Logging。
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT} --no-access-log
