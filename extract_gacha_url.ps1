<#
.SYNOPSIS
    从同目录下的 Client.log 中提取鸣潮抽卡链接

.DESCRIPTION
    鸣潮的 Client.log 是加密的二进制日志，本脚本：
    1. 跳过前 3 字节 BOM 头
    2. 逐字节解密：奇数 XOR 0xA5，偶数 XOR 0xEF（与项目内 decoder.rs 算法一致）
    3. 在解码后的文本中查找最新一条抽卡 URL（OpenWebView + sdkJson）
    4. 输出到控制台、剪贴板及 gacha_url.txt 文件

    使用方式：把本脚本放到 Client.log 同目录下，右键「使用 PowerShell 运行」即可。

.NOTES
    兼容 Windows PowerShell 5.1 与 PowerShell 7+。
#>

$ErrorActionPreference = 'Stop'
$OutputEncoding          = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logPath   = Join-Path $scriptDir 'Client.log'
$outPath   = Join-Path $scriptDir 'gacha_url.txt'

if (-not (Test-Path -LiteralPath $logPath)) {
    Write-Host "[X] 未在同目录下找到 Client.log" -ForegroundColor Red
    Write-Host "    路径: $logPath" -ForegroundColor Gray
    Read-Host '按回车键退出'
    exit 1
}

Write-Host "[1/3] 读取文件: $logPath" -ForegroundColor Cyan
# Client.log 会被游戏进程持续写入，必须用共享读模式打开，否则独占读取会失败
$bytes = $null
$fs = $null
try {
    $fs = [System.IO.File]::Open($logPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $len = [int]$fs.Length
    $bytes = New-Object byte[] $len
    $totalRead = 0
    while ($totalRead -lt $len) {
        $read = $fs.Read($bytes, $totalRead, $len - $totalRead)
        if ($read -eq 0) { break }
        $totalRead += $read
    }
} finally {
    if ($null -ne $fs) { $fs.Close() }
}
if ($null -eq $bytes -or $bytes.Length -lt 4) {
    Write-Host "[X] Client.log 文件过小或无法读取" -ForegroundColor Red
    Read-Host '按回车键退出'
    exit 1
}
Write-Host ("      文件大小: {0:N2} MB" -f ($bytes.Length / 1MB)) -ForegroundColor Gray

# 使用 C# 加速解码（失败则回退到纯 PowerShell 循环）
$decoderCode = @'
using System;
using System.IO;
using System.Text;
public static class WuwaLogDecoder {
    public static string Decode(string path) {
        byte[] bytes;
        // Client.log 会被游戏进程持续写入，必须用共享读模式打开
        using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) {
            bytes = new byte[fs.Length];
            int totalRead = 0, read;
            while (totalRead < bytes.Length && (read = fs.Read(bytes, totalRead, bytes.Length - totalRead)) > 0) {
                totalRead += read;
            }
            if (totalRead < bytes.Length) Array.Resize(ref bytes, totalRead);
        }
        if (bytes.Length < 4) return string.Empty;
        int len = bytes.Length - 3;
        byte[] decoded = new byte[len];
        for (int i = 0; i < len; i++) {
            byte b = bytes[i + 3];
            decoded[i] = (byte)((b % 2 == 1) ? (b ^ 0xA5) : (b ^ 0xEF));
        }
        return Encoding.UTF8.GetString(decoded);
    }
}
'@

Write-Host "[2/3] 解码日志..." -ForegroundColor Cyan
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$text = $null
try {
    if (-not ('WuwaLogDecoder' -as [type])) {
        Add-Type -TypeDefinition $decoderCode -ErrorAction Stop
    }
    $text = [WuwaLogDecoder]::Decode($logPath)
} catch {
    Write-Host "      Add-Type 不可用，回退到纯 PowerShell 解码（速度较慢）" -ForegroundColor Yellow
    $len = $bytes.Length - 3
    $decoded = New-Object byte[] $len
    for ($i = 0; $i -lt $len; $i++) {
        $b = $bytes[$i + 3]
        if ($b % 2 -eq 1) { $decoded[$i] = [byte]($b -bxor 0xA5) }
        else              { $decoded[$i] = [byte]($b -bxor 0xEF) }
        if (($i % 5242880) -eq 0 -and $i -gt 0) {
            Write-Host ("      进度: {0}%" -f [int]($i * 100 / $len)) -ForegroundColor Gray
        }
    }
    $text = [System.Text.Encoding]::UTF8.GetString($decoded)
}
$sw.Stop()
Write-Host ("      完成，耗时 {0:N2} 秒" -f $sw.Elapsed.TotalSeconds) -ForegroundColor Green

# 提取抽卡链接
Write-Host "[3/3] 搜索抽卡链接..." -ForegroundColor Cyan
$lineRe = [regex]::new('OpenWebView.*?sdkJson.*?"url":"([^"]+)"')
$tsRe   = [regex]::new('\[(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}:\d{3})\]')

$latestUrl  = $null
$latestTime = $null

foreach ($line in $text -split "`n") {
    if (-not $line.Contains('OpenWebView') -or -not $line.Contains('sdkJson')) { continue }

    $time = $null
    $tsMatch = $tsRe.Match($line)
    if ($tsMatch.Success) { $time = $tsMatch.Groups[1].Value }

    $m = $lineRe.Match($line)
    if ($m.Success) {
        $url = $m.Groups[1].Value
        if (($null -eq $latestTime) -or ($time -gt $latestTime)) {
            $latestTime = $time
            $latestUrl  = $url
        }
    }
}

# 回退：宽松正则
if ($null -eq $latestUrl) {
    $fallbackRe = [regex]::new('https[^\s"'']*/aki/gacha/index.html#/record[^\s"'']*')
    $m = $fallbackRe.Match($text)
    if ($m.Success) { $latestUrl = $m.Value }
}

if ($null -eq $latestUrl) {
    Write-Host "[X] 未找到抽卡链接，请先在游戏中打开抽卡历史记录页面" -ForegroundColor Red
    Read-Host '按回车键退出'
    exit 1
}

# 输出结果
Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host " 抽卡链接" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host $latestUrl -ForegroundColor White
if ($latestTime) {
    Write-Host (" 日志时间: {0}" -f $latestTime) -ForegroundColor Gray
}
Write-Host "================================================" -ForegroundColor Green
Write-Host ""

# 写入文件（UTF-8 无 BOM）
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($outPath, $latestUrl, $utf8NoBom)
Write-Host "[OK] 已保存到: $outPath" -ForegroundColor Cyan

# 复制到剪贴板
try {
    Set-Clipboard -Value $latestUrl
    Write-Host "[OK] 已复制到剪贴板" -ForegroundColor Cyan
} catch {
    Write-Host "[!] 剪贴板复制失败: $_" -ForegroundColor Yellow
}

Write-Host ""
Read-Host '按回车键退出'
