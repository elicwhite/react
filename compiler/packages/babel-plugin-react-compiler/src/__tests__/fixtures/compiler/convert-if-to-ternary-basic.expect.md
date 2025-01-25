
## Input

```javascript
function foo() {
  let result;
  if (cond) {
    result = 'hi';
  } else {
    result = 'foo';
  }
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
(kind: exception) cond is not defined