#!/usr/bin/env bash
# Start one LaunchLens worker in the foreground.
cd "$(dirname "$0")/../backend" && exec .venv/bin/python -m launchlens.worker.main
