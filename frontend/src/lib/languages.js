// Programming languages a candidate can pick for a single coding problem (LeetCode-style).
// METADATA ONLY — no CodeMirror import — so the picker + page stay out of the heavy editor bundle.
// `language` matches CodeEditor's normalizeLanguage keys (drives syntax highlighting); `filename`
// is the path the editor + runner key off (its extension chooses the runtime); `starter` is a
// minimal runnable skeleton so the candidate isn't staring at an empty buffer.

export const LANGUAGE_STORAGE_KEY = 'ts_candidate_lang'

export const LANGUAGES = [
  {
    key: 'python',
    label: 'Python 3',
    language: 'python',
    filename: 'solution.py',
    starter: `from typing import List, Dict, Optional, Tuple, Set
import collections
import math
import heapq


def solution():
    # Write your solution here
    pass


if __name__ == "__main__":
    print(solution())
`,
  },
  {
    key: 'javascript',
    label: 'JavaScript',
    language: 'javascript',
    filename: 'solution.js',
    starter: `// Standard built-ins (Math, Map, Set, JSON, ...) are available — no imports needed.

function solution() {
  // Write your solution here
}

console.log(solution())
`,
  },
  {
    key: 'typescript',
    label: 'TypeScript',
    language: 'typescript',
    filename: 'solution.ts',
    starter: `// Standard library types are available — no imports needed.

function solution(): unknown {
  // Write your solution here
  return null
}

console.log(solution())
`,
  },
  {
    key: 'java',
    label: 'Java',
    language: 'java',
    filename: 'Main.java',
    starter: `import java.util.*;
import java.io.*;
import java.util.stream.*;

public class Main {
    public static void main(String[] args) {
        // Write your solution here
    }
}
`,
  },
  {
    key: 'cpp',
    label: 'C++',
    language: 'cpp',
    filename: 'main.cpp',
    starter: `#include <bits/stdc++.h>
using namespace std;

int main() {
    // Write your solution here
    return 0;
}
`,
  },
  {
    key: 'c',
    label: 'C',
    language: 'c',
    filename: 'main.c',
    starter: `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

int main(void) {
    // Write your solution here
    return 0;
}
`,
  },
  {
    key: 'go',
    label: 'Go',
    language: 'go',
    filename: 'main.go',
    starter: `package main

import (
\t"bufio"
\t"fmt"
\t"os"
\t"sort"
\t"strings"
)

func main() {
\treader := bufio.NewReader(os.Stdin)
\t_, _, _ = reader, sort.Ints, strings.Split
\t// Write your solution here
\tfmt.Print()
}
`,
  },
  {
    key: 'ruby',
    label: 'Ruby',
    language: 'ruby',
    filename: 'solution.rb',
    starter: `require 'set'
# Core library is available; require others as needed.

def solution
  # Write your solution here
end

puts solution
`,
  },
  {
    key: 'rust',
    label: 'Rust',
    language: 'rust',
    filename: 'main.rs',
    starter: `use std::collections::{HashMap, HashSet, VecDeque, BTreeMap};

fn main() {
    // Write your solution here
}
`,
  },
  {
    key: 'php',
    label: 'PHP',
    language: 'php',
    filename: 'solution.php',
    starter: `<?php
// PHP's standard functions are globally available — no imports needed.

function solution() {
    // Write your solution here
}

echo solution();
`,
  },
]

// NOTE: the picker only offers languages the console "Run" path can actually execute
// (see backend codeExecutionService.entryRunCommand). C#/Kotlin/Swift still HIGHLIGHT for screens
// authored in them, but aren't offered here until their toolchains are confirmed in the sandbox.

// The standard interview set offered when a screen doesn't declare its own `languages`.
export const DEFAULT_LANGUAGE_KEYS = [
  'python',
  'javascript',
  'java',
  'cpp',
  'go',
  'typescript',
  'ruby',
  'rust',
]

export function languageByKey(key) {
  return LANGUAGES.find((l) => l.key === key) || null
}

// Map a stored work-sample / per-file language hint to one of our picker keys.
const LANGUAGE_ALIASES = {
  'c++': 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  golang: 'go',
  py: 'python',
  py3: 'python',
  python3: 'python',
  js: 'javascript',
  node: 'javascript',
  'node.js': 'javascript',
  nodejs: 'javascript',
  jsx: 'javascript',
  javascriptreact: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  typescriptreact: 'typescript',
  rb: 'ruby',
  rs: 'rust',
}

export function languageKeyFromHint(hint) {
  const h = String(hint || '').toLowerCase().trim()
  if (!h) return null
  const direct = LANGUAGES.find((l) => l.key === h || l.language === h)
  if (direct) return direct.key
  return LANGUAGE_ALIASES[h] || null
}

// Resolve the option list a candidate can pick from for a given work sample. Prefer the screen's
// declared `languages` (mapped to our keys); else offer the standard default set.
export function resolveLanguageOptions(declared) {
  const mapped = Array.isArray(declared)
    ? declared.map(languageKeyFromHint).filter(Boolean)
    : []
  const keys = mapped.length ? Array.from(new Set(mapped)) : DEFAULT_LANGUAGE_KEYS
  return keys.map(languageByKey).filter(Boolean)
}
