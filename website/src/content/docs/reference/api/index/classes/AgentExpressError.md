---
editUrl: false
next: false
prev: false
title: "AgentExpressError"
---

Base error class for all Agent Express errors.

Every error in the framework extends this class, providing a machine-readable
`code`, a `retryable` flag for middleware like `turn.retry()`, and an optional
`cause` for error chaining.

## Example

```typescript
try {
  await agent.run({ input: "test" }).result
} catch (err) {
  if (err instanceof AgentExpressError) {
    console.log(err.code, err.retryable)
  }
}
```

## Extends

- `Error`

## Extended by

- [`AbortError`](/reference/api/index/classes/aborterror/)
- [`ModelError`](/reference/api/index/classes/modelerror/)
- [`ToolDeniedError`](/reference/api/index/classes/tooldeniederror/)
- [`ToolExecutionError`](/reference/api/index/classes/toolexecutionerror/)
- [`SessionClosedError`](/reference/api/index/classes/sessionclosederror/)
- [`SessionBusyError`](/reference/api/index/classes/sessionbusyerror/)
- [`StructuredOutputParseError`](/reference/api/index/classes/structuredoutputparseerror/)
- [`StructuredOutputValidationError`](/reference/api/index/classes/structuredoutputvalidationerror/)
- [`BudgetExceededError`](/reference/api/index/classes/budgetexceedederror/)
- [`InputGuardrailError`](/reference/api/index/classes/inputguardrailerror/)
- [`OutputGuardrailError`](/reference/api/index/classes/outputguardrailerror/)
- [`TurnTimeoutError`](/reference/api/index/classes/turntimeouterror/)

## Constructors

### Constructor

> **new AgentExpressError**(`message`, `code`, `retryable`, `cause?`): `AgentExpressError`

#### Parameters

##### message

`string`

##### code

`string`

##### retryable

`boolean`

##### cause?

`Error`

#### Returns

`AgentExpressError`

#### Overrides

`Error.constructor`

## Properties

### cause?

> `readonly` `optional` **cause?**: `Error`

Original error that caused this one, if any.

#### Overrides

`Error.cause`

***

### code

> **code**: `string`

Machine-readable error code (e.g., "ABORT", "RATE_LIMIT", "TOOL_DENIED").

***

### retryable

> `readonly` **retryable**: `boolean`

Whether this error can be retried by retry middleware.
