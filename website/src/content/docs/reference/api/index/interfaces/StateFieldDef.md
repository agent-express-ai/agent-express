---
editUrl: false
next: false
prev: false
title: "StateFieldDef"
---

Declaration for a single state field in a middleware's `state` property.

Type is inferred from the `default` value. If a `reducer` is provided,
writes dispatch through it: `state.field = delta` → `reducer(current, delta)`.

## Example

```typescript
state: {
  totalCost: { default: 0, reducer: (prev, delta) => prev + delta },
  isActive: { default: true },  // type inferred as boolean
}
```

## Type Parameters

### T

`T` = `unknown`

## Properties

### default

> **default**: `T`

Default value. TypeScript infers the field type from this.

***

### reducer?

> `optional` **reducer?**: (`prev`, `delta`) => `T`

Optional reducer for merge semantics. Without it, writes use last-write-wins.

#### Parameters

##### prev

`T`

##### delta

`T`

#### Returns

`T`
