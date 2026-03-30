export interface CommandBlock {
  id: string; // unique random id
  type: 'global' | 'input' | 'video' | 'audio' | 'filter' | 'output' | 'custom' | 'unknown';
  flag: string; // e.g. "-crf", "-y", or "" if it's just an output file
  value: string; // e.g. "23", "input.mp4", or "" if it's a flag without value
}

// Very simplistic classification mapping
const FLAG_MAP: Record<string, CommandBlock['type']> = {
  '-i': 'input',
  '-y': 'global',
  '-n': 'global',
  '-vn': 'video',
  '-c:v': 'video',
  '-vcodec': 'video',
  '-crf': 'video',
  '-b:v': 'video',
  '-pix_fmt': 'video',
  '-an': 'audio',
  '-c:a': 'audio',
  '-acodec': 'audio',
  '-b:a': 'audio',
  '-ar': 'audio',
  '-vf': 'filter',
  '-filter_complex': 'filter',
  '-af': 'filter',
};

// Generates a simple ID
const generateId = () => Math.random().toString(36).substring(2, 9);

export function parseFfmpegCommand(command: string): CommandBlock[] {
  // Sanitize: Strip trailing backslashes masking newlines, and general newlines from copy-pasting
  const sanitized = command.replace(/\\\r?\n/g, ' ').replace(/\r?\n/g, ' ').trim();
  
  // Regex to split by spaces but preserve strings in quotes
  const regex = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;
  const rawTokens = sanitized.match(regex) || [];
  
  // Automatically unquote token boundaries safely
  const tokens = rawTokens.map(t => t.replace(/^["'](.*)["']$/, '$1'));
  
  const blocks: CommandBlock[] = [];
  let i = 0;

  if (tokens[0] === 'ffmpeg') {
    i++;
  }

  while (i < tokens.length) {
    const token = tokens[i];
    
    if (token.startsWith('-')) {
      const type = FLAG_MAP[token] || 'custom';
      
      if (i + 1 < tokens.length && !tokens[i+1].startsWith('-')) {
        blocks.push({
          id: generateId(),
          type,
          flag: token,
          value: tokens[i+1]
        });
        i += 2;
      } else {
        blocks.push({
          id: generateId(),
          type,
          flag: token,
          value: ''
        });
        i++;
      }
    } else {
      blocks.push({
        id: generateId(),
        type: 'output',
        flag: '',
        value: token
      });
      i++;
    }
  }

  return blocks;
}

export function serializeFfmpegCommand(blocks: CommandBlock[]): string {
  const parts: string[] = [];
  
  for (const block of blocks) {
    if (block.flag) {
      parts.push(block.flag);
    }
    if (block.value) {
      if (block.value.includes(' ') && !/^["'].*["']$/.test(block.value)) {
        parts.push(`"${block.value}"`);
      } else {
        parts.push(block.value);
      }
    }
  }
  
  return parts.join(' ');
}
