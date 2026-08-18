import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Runs a PowerShell command via Base64-encoded -EncodedCommand to avoid
 * any shell-escaping nightmares with PInvoke signatures.
 */
function psEncoded(script: string): Promise<string> {
  const base64 = Buffer.from(script, "utf16le").toString("base64");
  return execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    base64,
  ], { timeout: 10_000 }).then(({ stdout }) => stdout);
}

export async function setCursorPosition(x: number, y: number): Promise<void> {
  await psEncoded(
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(x)},${Math.round(y)})`
  );
}

export async function setCursorNormalizedPosition(x: number, y: number): Promise<void> {
  const nx = Math.max(0, Math.min(1000, Math.round(x)));
  const ny = Math.max(0, Math.min(1000, Math.round(y)));
  await psEncoded(`
    Add-Type -AssemblyName System.Windows.Forms
    $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $x = $area.X + [Math]::Round((${nx} / 1000.0) * [Math]::Max(0, $area.Width - 1))
    $y = $area.Y + [Math]::Round((${ny} / 1000.0) * [Math]::Max(0, $area.Height - 1))
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x,$y)
  `);
}

export async function typeAtCursor(text: string): Promise<void> {
  const encoded = Buffer.from(text, "utf8").toString("base64");
  await psEncoded(`
    Add-Type -AssemblyName System.Windows.Forms
    $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
    [System.Windows.Forms.Clipboard]::SetText($text)
    Start-Sleep -Milliseconds 80
    [System.Windows.Forms.SendKeys]::SendWait('^v')
  `);
}

export async function clickCursor(): Promise<void> {
  await psEncoded(`
    $signature = '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, int extraInfo);'
    $MouseEvent = Add-Type -MemberDefinition $signature -Name "Win32MouseEventNew" -Namespace Win32Functions -PassThru
    $MouseEvent::mouse_event(0x02,0,0,0,0)
    Start-Sleep -Milliseconds 50
    $MouseEvent::mouse_event(0x04,0,0,0,0)
  `);
}

export async function rightClickCursor(): Promise<void> {
  await psEncoded(`
    $signature = '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, int extraInfo);'
    $MouseEvent = Add-Type -MemberDefinition $signature -Name "Win32MouseEventNew" -Namespace Win32Functions -PassThru
    $MouseEvent::mouse_event(0x08,0,0,0,0)
    Start-Sleep -Milliseconds 50
    $MouseEvent::mouse_event(0x10,0,0,0,0)
  `);
}

export async function scrollCursor(direction: "up" | "down"): Promise<void> {
  const data = direction === "up" ? 120 : -120;
  await psEncoded(`
    $signature = '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, int extraInfo);'
    $MouseEvent = Add-Type -MemberDefinition $signature -Name "Win32MouseEventNew" -Namespace Win32Functions -PassThru
    $MouseEvent::mouse_event(0x0800,0,0,${data},0)
  `);
}
