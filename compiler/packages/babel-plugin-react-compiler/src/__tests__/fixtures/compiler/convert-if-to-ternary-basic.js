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
