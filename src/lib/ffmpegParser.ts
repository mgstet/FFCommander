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
  // Regex to split by spaces but preserve strings in quotes
  const regex = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;
  const tokens = command.match(regex) || [];
  
  const blocks: CommandBlock[] = [];
  let i = 0;

  // Let's strip out 'ffmpeg' if it's at the start.
  if (tokens[0] === 'ffmpeg') {
    i++;
  }

  while (i < tokens.length) {
    const token = tokens[i];
    
    // If it's a flag
    if (token.startsWith('-')) {
      const type = FLAG_MAP[token] || 'custom';
      
      // Lookahead: does the next token exist and is it NOT a flag?
      if (i + 1 < tokens.length && !tokens[i+1].startsWith('-')) {
        blocks.push({
          id: generateId(),
          type,
          flag: token,
          value: tokens[i+1]
        });
        i += 2;
      } else {
        // Flag with no value
        blocks.push({
          id: generateId(),
          type,
          flag: token,
          value: ''
        });
        i++;
      }
    } else {
      // It's a standalone value (usually output file)
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
      parts.push(block.value);
    }
  }
  
  return parts.join(' ');
}
