$csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
& $csc /nologo /platform:x86 /target:exe /out:"D:\31689\Documents\code\ai coding\format-factory\read_db.exe" "D:\31689\Documents\code\ai coding\format-factory\read_db.cs"
Write-Host "Compile exit code: $LASTEXITCODE"
if ($LASTEXITCODE -eq 0) {
    & "D:\31689\Documents\code\ai coding\format-factory\read_db.exe"
    Write-Host "Run exit code: $LASTEXITCODE"
}
