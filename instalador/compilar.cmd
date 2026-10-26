@echo off
rem Compila o instalador com o .NET Framework 4 que acompanha o Windows. Rode na raiz do repositório.
set FW=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319
"%FW%\csc.exe" /nologo /target:winexe /optimize+ /out:Instalador-LookOutside-PTBR.exe /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:"%FW%\System.Web.Extensions.dll" /resource:js\plugins\LookOutside_PTBR.js,LookOutside_PTBR.js /resource:js\plugins\LookOutside_PTBR_catalog.js,LookOutside_PTBR_catalog.js /resource:instalador\logo.png,logo.png /win32icon:instalador\logo.ico instalador\InstaladorPTBR.cs