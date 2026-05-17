@echo off
echo ============================================
echo  Scripture Suggestion Panel — Python Setup
echo ============================================
echo.
echo Installing Python dependencies...
pip install -r "%~dp0requirements.txt"
echo.
echo Done. You can now launch the app with: npm run dev
pause
