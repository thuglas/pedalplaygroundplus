@echo off
rem Serves Pedal Playground at http://localhost:8000 (the page needs a web server to load its pedal lists)
cd /d "%~dp0"
start "" http://localhost:8000/
python serve-local.py 8000
