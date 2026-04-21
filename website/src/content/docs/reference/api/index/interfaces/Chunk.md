---
editUrl: false
next: false
prev: false
title: "Chunk"
---

Retrieved knowledge fragment from document search.
Returned by retriever functions, injected into model context by `search.file()`.

## Properties

### score?

> `optional` **score?**: `number`

Relevance score (0-1).

***

### source?

> `optional` **source?**: `object`

Source metadata for citation tracking.

#### section?

> `optional` **section?**: `string`

Section within the document.

#### title?

> `optional` **title?**: `string`

Document title.

#### url?

> `optional` **url?**: `string`

Source URL or file path.

***

### text

> **text**: `string`

Chunk text content.
