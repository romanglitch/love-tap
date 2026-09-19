#!/bin/bash
export $(grep -v '^#' .env | xargs)
open-terminal run --host "$OT_HOST" --port "$OT_PORT" --api-key "$OT_API_KEY"