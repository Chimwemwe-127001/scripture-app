@echo off
echo ============================================
echo  Scripture Suggestion Panel: Python Setup
echo ============================================
echo.
echo Installing Python dependencies...
pip install -r "%~dp0requirements.txt"
echo.
echo The first time you press Listen, the speech model (about 1.5 GB) is downloaded.
echo An NVIDIA GPU is used automatically when there is one.
echo.
echo Done. You can now launch the app with: npm run dev
pause
