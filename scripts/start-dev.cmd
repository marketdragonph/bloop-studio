@echo off
rem Starts Bloop Studio from source (used by the desktop shortcut until the installer exists).
cd /d "%~dp0.."
call npm start
