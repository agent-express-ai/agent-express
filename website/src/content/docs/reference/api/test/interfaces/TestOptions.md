---
editUrl: false
next: false
prev: false
title: "TestOptions"
---

Options for `testAgent()`.

## Properties

### expect?

> `optional` **expect?**: `object`

Assertions to check against the run result.

#### costUnder?

> `optional` **costUnder?**: `number`

Maximum acceptable cost in USD (requires guard.budget() middleware).

#### outputContains?

> `optional` **outputContains?**: `string`

Substring that should appear in the text.

#### outputMatches?

> `optional` **outputMatches?**: `RegExp`

Regex the text should match.

#### toolsCalled?

> `optional` **toolsCalled?**: `string`[]

Tool names that should have been called (requires observe.tools() middleware).

***

### input

> **input**: `string` \| `string`[]

User message(s). String for single turn, string[] for multi-turn session.
