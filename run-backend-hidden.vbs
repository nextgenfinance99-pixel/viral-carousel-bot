' run-backend-hidden.vbs — start the reel bot backend with no console window.
'
' Windows Task Scheduler can launch a .bat at logon, but it flashes a console and
' leaves a window on the desktop all day. This wrapper runs the same command hidden
' (the 0 in shell.Run) and does not wait, so the backend keeps running after logon.
'
' It REFUSES to start a second copy. Two backends polling the same Telegram bot both
' get 409 Conflict and the review buttons stop working for everyone — the single
' most disruptive failure this project has, and a logon script is exactly how you
' end up with a duplicate (log in twice, or start.bat already running).
'
' Logs append to backend\logs\backend.log so a failed start is diagnosable instead
' of silently invisible.

Dim shell, fso, root, logDir, cmd, exec, netstat

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
logDir = root & "\backend\logs"
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)

' Already listening on 3001? Then a backend is up; leave it alone.
Set exec = shell.Exec("cmd /c netstat -ano -p tcp | findstr LISTENING | findstr :3001")
netstat = exec.StdOut.ReadAll()
If InStr(netstat, ":3001") > 0 Then
  Dim f
  Set f = fso.OpenTextFile(logDir & "\backend.log", 8, True)
  f.WriteLine Now & " [launcher] backend already listening on 3001 - not starting a second copy"
  f.Close
  WScript.Quit 0
End If

shell.CurrentDirectory = root & "\backend"

' cmd /c so the shell handles the redirect. 0 = hidden, False = do not block.
cmd = "cmd /c node server.js >> """ & logDir & "\backend.log"" 2>&1"
shell.Run cmd, 0, False
