FROM python:3.12-slim

WORKDIR /app

COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/main.py .
COPY static/ ./static/

# Run unprivileged. Everything the app reads (/proc, /sys, mount stats,
# the Docker API over TCP) is available to a normal user.
RUN useradd --uid 1000 --no-create-home --shell /usr/sbin/nologin app
USER app

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
