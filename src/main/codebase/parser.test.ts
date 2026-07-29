// AgentForge CB: 代码解析器测试

import { describe, it, expect } from 'vitest'
import {
  detectLanguage,
  parseCodeFile,
  isCodeLanguage,
  getLanguageDisplayName,
  getSupportedCodeExtensions,
} from './parser'

describe('detectLanguage', () => {
  it('should detect TypeScript files', () => {
    expect(detectLanguage('foo.ts')).toBe('typescript')
    expect(detectLanguage('foo.tsx')).toBe('typescript')
    expect(detectLanguage('foo.mts')).toBe('typescript')
  })

  it('should detect JavaScript files', () => {
    expect(detectLanguage('foo.js')).toBe('javascript')
    expect(detectLanguage('foo.jsx')).toBe('javascript')
    expect(detectLanguage('foo.mjs')).toBe('javascript')
  })

  it('should detect Python files', () => {
    expect(detectLanguage('foo.py')).toBe('python')
    expect(detectLanguage('foo.pyw')).toBe('python')
  })

  it('should detect Go files', () => {
    expect(detectLanguage('main.go')).toBe('go')
  })

  it('should detect Rust files', () => {
    expect(detectLanguage('main.rs')).toBe('rust')
  })

  it('should detect Java files', () => {
    expect(detectLanguage('Main.java')).toBe('java')
  })

  it('should detect C/C++ files', () => {
    expect(detectLanguage('foo.c')).toBe('c')
    expect(detectLanguage('foo.h')).toBe('c')
    expect(detectLanguage('foo.cpp')).toBe('cpp')
    expect(detectLanguage('foo.hpp')).toBe('cpp')
  })

  it('should detect CSS/SCSS files', () => {
    expect(detectLanguage('style.css')).toBe('css')
    expect(detectLanguage('style.scss')).toBe('scss')
  })

  it('should detect JSON/YAML/Markdown', () => {
    expect(detectLanguage('config.json')).toBe('json')
    expect(detectLanguage('config.yaml')).toBe('yaml')
    expect(detectLanguage('config.yml')).toBe('yaml')
    expect(detectLanguage('README.md')).toBe('markdown')
  })

  it('should detect Dockerfile by name', () => {
    expect(detectLanguage('Dockerfile')).toBe('dockerfile')
    expect(detectLanguage('dockerfile.dev')).toBe('dockerfile')
  })

  it('should return unknown for unrecognized extensions', () => {
    expect(detectLanguage('foo.xyz')).toBe('unknown')
    expect(detectLanguage('filewithnoext')).toBe('unknown')
  })
})

describe('parseCodeFile (TypeScript)', () => {
  const tsCode = `// A utility module

/** Calculate sum */
export function calculateSum(a: number, b: number): number {
  return a + b
}

export interface User {
  id: string
  name: string
}

export class UserService {
  private users: User[] = []

  addUser(user: User): void {
    this.users.push(user)
  }

  getUser(id: string): User | undefined {
    return this.users.find(u => u.id === id)
  }
}

export type Status = 'active' | 'inactive'

export const MAX_RETRIES = 3
`

  it('should extract symbols', () => {
    const result = parseCodeFile(tsCode, 'utils.ts')

    expect(result.language).toBe('typescript')
    expect(result.symbols.length).toBeGreaterThan(0)

    const names = result.symbols.map(s => s.name)
    expect(names).toContain('calculateSum')
    expect(names).toContain('User')
    expect(names).toContain('UserService')
    expect(names).toContain('Status')
    expect(names).toContain('MAX_RETRIES')
  })

  it('should extract symbol types correctly', () => {
    const result = parseCodeFile(tsCode, 'utils.ts')

    const byName = new Map(result.symbols.map(s => [s.name, s]))

    expect(byName.get('calculateSum')?.symbolType).toBe('function')
    expect(byName.get('User')?.symbolType).toBe('interface')
    expect(byName.get('UserService')?.symbolType).toBe('class')
    expect(byName.get('Status')?.symbolType).toBe('type')
    expect(byName.get('MAX_RETRIES')?.symbolType).toBe('constant')
  })

  it('should set visibility for exported symbols', () => {
    const result = parseCodeFile(tsCode, 'utils.ts')

    const exportedFunc = result.symbols.find(s => s.name === 'calculateSum')
    expect(exportedFunc?.visibility).toBe('public')
  })

  it('should extract doc comments', () => {
    const result = parseCodeFile(tsCode, 'utils.ts')

    const sumFunc = result.symbols.find(s => s.name === 'calculateSum')
    expect(sumFunc?.docComment).toBeDefined()
    expect(sumFunc?.docComment).toContain('Calculate sum')
  })

  it('should generate code chunks', () => {
    const result = parseCodeFile(tsCode, 'utils.ts')

    expect(result.chunks.length).toBeGreaterThan(0)

    // Each chunk should have content and line numbers
    for (const chunk of result.chunks) {
      expect(chunk.content.length).toBeGreaterThan(0)
      expect(chunk.startLine).toBeGreaterThan(0)
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine)
      expect(chunk.tokenCount).toBeGreaterThan(0)
    }
  })

  it('should count lines correctly', () => {
    const result = parseCodeFile(tsCode, 'utils.ts')
    expect(result.lineCount).toBe(tsCode.split('\n').length)
  })
})

describe('parseCodeFile (Python)', () => {
  const pyCode = `"""Module docstring"""

def hello(name: str) -> str:
    """Say hello"""
    return f"Hello, {name}"

class Calculator:
    """A simple calculator"""
    
    def add(self, a: int, b: int) -> int:
        return a + b
    
    def _private(self):
        pass

async def fetch_data(url: str):
    """Fetch data async"""
    return await get(url)
`

  it('should extract Python symbols', () => {
    const result = parseCodeFile(pyCode, 'main.py')

    expect(result.language).toBe('python')
    expect(result.symbols.length).toBeGreaterThan(0)

    const names = result.symbols.map(s => s.name)
    expect(names).toContain('hello')
    expect(names).toContain('Calculator')
    expect(names).toContain('add')
    expect(names).toContain('fetch_data')
  })

  it('should detect methods vs functions', () => {
    const result = parseCodeFile(pyCode, 'main.py')

    const hello = result.symbols.find(s => s.name === 'hello')
    expect(hello?.symbolType).toBe('function')

    const add = result.symbols.find(s => s.name === 'add')
    expect(add?.symbolType).toBe('method')
  })

  it('should set private visibility for underscore names', () => {
    const result = parseCodeFile(pyCode, 'main.py')

    const privateMethod = result.symbols.find(s => s.name === '_private')
    expect(privateMethod?.visibility).toBe('private')
  })

  it('should extract Python docstrings', () => {
    const result = parseCodeFile(pyCode, 'main.py')

    const hello = result.symbols.find(s => s.name === 'hello')
    expect(hello?.docComment).toBeDefined()
  })
})

describe('parseCodeFile (Go)', () => {
  const goCode = `package main

import "fmt"

func Add(a, b int) int {
    return a + b
}

func (c *Calculator) Multiply(x, y int) int {
    return x * y
}

type Config struct {
    Port int
}
`

  it('should extract Go symbols', () => {
    const result = parseCodeFile(goCode, 'main.go')

    expect(result.language).toBe('go')
    const names = result.symbols.map(s => s.name)
    expect(names).toContain('Add')
    expect(names).toContain('Multiply')
    expect(names).toContain('Config')
  })
})

describe('parseCodeFile (Rust)', () => {
  const rustCode = `pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

fn private_func() {
    println!("private");
}

pub struct Config {
    pub port: u16,
}

pub trait Handler {
    fn handle(&self);
}
`

  it('should extract Rust symbols', () => {
    const result = parseCodeFile(rustCode, 'main.rs')

    expect(result.language).toBe('rust')
    const names = result.symbols.map(s => s.name)
    expect(names).toContain('add')
    expect(names).toContain('private_func')
    expect(names).toContain('Config')
    expect(names).toContain('Handler')
  })

  it('should set visibility for pub functions', () => {
    const result = parseCodeFile(rustCode, 'main.rs')

    const pubFn = result.symbols.find(s => s.name === 'add')
    expect(pubFn?.visibility).toBe('public')
  })
})

describe('parseCodeFile (generic/JSON)', () => {
  const jsonContent = `{
  "name": "test",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.0.0"
  }
}`

  it('should parse JSON with chunking', () => {
    const result = parseCodeFile(jsonContent, 'package.json')

    expect(result.language).toBe('json')
    expect(result.symbols).toHaveLength(0)
    expect(result.chunks.length).toBeGreaterThan(0)
  })
})

describe('isCodeLanguage', () => {
  it('should return true for programming languages', () => {
    expect(isCodeLanguage('typescript')).toBe(true)
    expect(isCodeLanguage('python')).toBe(true)
    expect(isCodeLanguage('go')).toBe(true)
    expect(isCodeLanguage('rust')).toBe(true)
  })

  it('should return false for data formats', () => {
    expect(isCodeLanguage('json')).toBe(false)
    expect(isCodeLanguage('yaml')).toBe(false)
    expect(isCodeLanguage('markdown')).toBe(false)
  })
})

describe('getLanguageDisplayName', () => {
  it('should return display names', () => {
    expect(getLanguageDisplayName('typescript')).toBe('TypeScript')
    expect(getLanguageDisplayName('python')).toBe('Python')
    expect(getLanguageDisplayName('cpp')).toBe('C++')
  })
})

describe('getSupportedCodeExtensions', () => {
  it('should return a non-empty array', () => {
    const exts = getSupportedCodeExtensions()
    expect(exts.length).toBeGreaterThan(0)
    expect(exts).toContain('.ts')
    expect(exts).toContain('.py')
    expect(exts).toContain('.go')
  })
})
