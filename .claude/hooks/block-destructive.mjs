// Política del proyecto: Claude Code no ejecuta acciones destructivas (código, consultas, comandos),
// aunque el usuario lo pida. Corre como hook PreToolUse sobre Bash, PowerShell y herramientas MCP.
// Revisa el comando y el contenido de los scripts que ese comando ejecuta (bun x.ts, node x.mjs, psql -f x.sql…).
// Escribir código que borra (p. ej. la purga de la papelera) sigue permitido: lo que se bloquea es ejecutarlo
// directamente. Para cambiar la política, edita este archivo a mano: Claude no puede desactivarla.
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

const RULES = [
  // SQL
  [/\btruncate\s+(table\s+)?["\w.]/i, 'TRUNCATE (vacía tablas)'],
  [/\bdrop\s+(table|schema|database|index|view|materialized\s+view|type|extension|function|role|user|sequence|trigger|policy)\b/i, 'DROP (elimina objetos de la base de datos)'],
  [/\bdelete\s+from\b/i, 'DELETE FROM (borra filas)'],
  [/\balter\s+table\b[^;]*\bdrop\s+(column|constraint)\b/i, 'ALTER TABLE … DROP (elimina columnas o restricciones)'],
  // Almacenamiento
  [/\bDelete(Objects?|Bucket)(Command)?\b/, 'borrado de objetos o buckets en S3'],
  // Ramas, proyectos y BD en Neon
  [/\bneonctl\b.*\b(delete|reset)\b/i, 'borrado o reseteo con neonctl'],
  [/\bdrizzle-kit\s+(drop|push\b.*--force)/i, 'drizzle-kit drop / push --force'],
  // Sistema de archivos
  [/\brm\s+(-\w*[rf]\w*\s+)+/, 'rm -r / rm -f'],
  [/\bRemove-Item\b[^|;]*-(Recurse|Force)\b/i, 'Remove-Item -Recurse / -Force'],
  [/\b(rmdir|rd)\s+\/s\b/i, 'rmdir /s'],
  [/\bdel\s+(\/\w\s+)*\/s\b/i, 'del /s'],
  // Git
  [/\bgit\s+reset\s+--hard\b/, 'git reset --hard'],
  [/\bgit\s+push\b[^;|&]*(\s--force(-with-lease)?\b|\s-f\b|\s\+\S)/, 'git push --force'],
  [/\bgit\s+clean\s+-\w*f/, 'git clean -f'],
  [/\bgit\s+branch\s+(-D|--delete\s+--force)\b/, 'git branch -D'],
  [/\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/, 'git checkout/restore . (descarta cambios)'],
  [/\bgit\s+stash\s+(drop|clear)\b/, 'git stash drop/clear'],
]

const SCRIPT_EXT = /\.(m?[jt]s|cjs|cts|sql|py|sh|ps1)$/i

/** Archivos de script mencionados en el comando que existen en el disco. */
function referencedScripts(command, cwd) {
  const tokens = command.match(/"[^"]+"|'[^']+'|[^\s;|&<>()]+/g) ?? []
  return tokens
    .map(t => t.replace(/^['"]|['"]$/g, ''))
    .filter(t => SCRIPT_EXT.test(t))
    .map(t => (isAbsolute(t) ? t : resolve(cwd, t)))
    .filter(p => existsSync(p))
}

function findViolation(text) {
  for (const [pattern, label] of RULES) {
    if (pattern.test(text)) return label
  }
  return null
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Bloqueado por la política del proyecto (.claude/hooks/block-destructive.mjs): ${reason}. `
        + 'En este proyecto Claude no ejecuta acciones destructivas aunque se lo pidan. Entrega el comando o la consulta '
        + 'para que la persona la ejecute ella misma.',
    },
  }))
  process.exit(0)
}

const input = JSON.parse(readFileSync(0, 'utf8') || '{}')
const tool = input.tool_name ?? ''
const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd()

if (tool === 'Bash' || tool === 'PowerShell') {
  const command = String(input.tool_input?.command ?? '')
  const direct = findViolation(command)
  if (direct) deny(`el comando contiene ${direct}`)
  for (const file of referencedScripts(command, cwd)) {
    const found = findViolation(readFileSync(file, 'utf8'))
    if (found) deny(`el script ${file} contiene ${found}`)
  }
}
else if (tool.startsWith('mcp__')) {
  const found = findViolation(JSON.stringify(input.tool_input ?? {}))
  if (found) deny(`la herramienta ${tool} recibiría ${found}`)
}
