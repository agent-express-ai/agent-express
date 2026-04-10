---
editUrl: false
next: false
prev: false
title: "TestModelOptions"
---

Options for TestModel.

## Properties

### defaultText?

> `optional` **defaultText?**: `string`

Default text when no responses configured or after responses exhausted (with auto-tool). Default: "test response".

***

### responses?

> `optional` **responses?**: [`ModelResponse`](/reference/api/index/interfaces/modelresponse/)[]

Ordered list of responses. Each model call gets the next response.
