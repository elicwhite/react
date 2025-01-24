
## Input

```javascript
function foo() {
  const cond = Math.random();
  let result;
  result = cond ? 'hi' : 'foo';
  return result;
}

export const FIXTURE_ENTRYPOINT = {
  fn: foo,
  params: [],
  isComponent: false,
};

```

## Code

```javascript
function foo() {
  const cond = Math.random();
  let result;
  result = cond ? "hi" : "foo";
  return result;
}

export const FIXTURE_ENTRYPOINT = {
  fn: foo,
  params: [],
  isComponent: false,
};

```
      
### Eval output
(kind: ok) "hi"