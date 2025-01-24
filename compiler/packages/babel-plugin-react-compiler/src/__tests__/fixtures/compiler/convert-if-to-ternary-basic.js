function foo() {
  // const cond = Math.random();
  let result;
  if (cond) {
    result = 'hi';
  } else {
    result = 'foo';
  }
  // result = cond ? 'hi' : 'foo';
  return result;
}

export const FIXTURE_ENTRYPOINT = {
  fn: foo,
  params: [],
  isComponent: false,
};
