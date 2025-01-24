import {
  BasicBlock,
  HIRFunction,
  Identifier,
  IfTerminal,
  InstructionKind,
  makeInstructionId,
  TernaryTerminal,
} from '../HIR';

import {
  createTemporaryPlace,
  markInstructionIds,
  markPredecessors,
  reversePostorderBlocks,
} from '../HIR/HIRBuilder';

export function convertIfToTernary(fn: HIRFunction): void {
  for (const stmt of fn.body.blocks.values()) {
    if (stmt.terminal.kind === 'if') {
      convertIfBlock(fn, stmt);
    }
  }

  reversePostorderBlocks(fn.body);
  markInstructionIds(fn.body);
  markPredecessors(fn.body);
}

function convertIfBlock(fn: HIRFunction, ifBlock: BasicBlock): void {
  const ifStatement = ifBlock.terminal as IfTerminal;
  const consequent = fn.body.blocks.get(ifStatement.consequent);
  const alternate = fn.body.blocks.get(ifStatement.alternate);

  const areAllGoTos =
    consequent?.terminal.kind === 'goto' && alternate?.terminal.kind === 'goto';

  if (!areAllGoTos) {
    return;
  }

  const fallthroughBlock = fn.body.blocks.get(ifStatement.fallthrough)!;
  const hasSingularPhi = fallthroughBlock.phis.size === 1;

  if (!hasSingularPhi) {
    return;
  }

  const branchBlockId = fn.env.nextBlockId;
  const branchBlock: BasicBlock = {
    kind: 'value',
    id: branchBlockId,
    terminal: {
      kind: 'branch',
      id: makeInstructionId(0),
      test: ifStatement.test,
      consequent: ifStatement.consequent,
      alternate: ifStatement.alternate,
      fallthrough: ifStatement.fallthrough,
      loc: ifStatement.loc,
    },
    instructions: [],
    preds: new Set([ifBlock.id]),
    phis: new Set(),
  };

  fn.body.blocks.set(branchBlockId, branchBlock);

  const ternary: TernaryTerminal = {
    kind: 'ternary',
    id: makeInstructionId(0),
    test: branchBlockId,
    loc: ifStatement.loc,
    fallthrough: ifStatement.fallthrough,
  };

  ifBlock.terminal = ternary;

  const singlePhi = Array.from(fallthroughBlock.phis.values())[0];
  const assigneValues = new Set(
    Array.from(singlePhi.operands.values()).map(v => v.identifier),
  );

  const oldIdentifierToNewIdentifier = new Map<Identifier, Identifier>();

  const temporaryPhiOperandPlace = createTemporaryPlace(
    fn.env,
    ifStatement.loc,
  );

  consequent.preds = new Set([branchBlockId]);
  consequent.kind = 'value';
  for (const inst of consequent.instructions) {
    if (inst.value.kind === 'StoreLocal') {
      if (inst.value.lvalue.kind === InstructionKind.Reassign) {
        const reassignedIdentifier = inst.value.lvalue.place;
        if (
          reassignedIdentifier.kind !== 'Identifier' ||
          !assigneValues.has(reassignedIdentifier.identifier)
        ) {
          continue;
        }

        const newPlace = createTemporaryPlace(
          fn.env,
          reassignedIdentifier.identifier.loc,
        );

        newPlace.identifier.declarationId =
          temporaryPhiOperandPlace.identifier.declarationId;

        oldIdentifierToNewIdentifier.set(
          inst.value.lvalue.place.identifier,
          newPlace.identifier,
        );

        inst.value.lvalue = {
          kind: InstructionKind.Const,
          place: newPlace,
        };
      }
    }
  }

  alternate.preds = new Set([branchBlockId]);
  alternate.kind = 'value';
  for (const inst of alternate.instructions) {
    if (inst.value.kind === 'StoreLocal') {
      if (inst.value.lvalue.kind === InstructionKind.Reassign) {
        const reassignedIdentifier = inst.value.lvalue.place;
        if (
          reassignedIdentifier.kind !== 'Identifier' ||
          !assigneValues.has(reassignedIdentifier.identifier)
        ) {
          continue;
        }

        const newPlace = createTemporaryPlace(
          fn.env,
          reassignedIdentifier.identifier.loc,
        );

        newPlace.identifier.declarationId =
          temporaryPhiOperandPlace.identifier.declarationId;

        oldIdentifierToNewIdentifier.set(
          inst.value.lvalue.place.identifier,
          newPlace.identifier,
        );

        inst.value.lvalue = {
          kind: InstructionKind.Const,
          place: newPlace,
        };
      }
    }
  }

  singlePhi.operands.forEach(operand => {
    if (oldIdentifierToNewIdentifier.has(operand.identifier)) {
      operand.identifier = oldIdentifierToNewIdentifier.get(
        operand.identifier,
      )!;
    }
  });

  const originalPhiReturn = singlePhi.place;
  singlePhi.place = temporaryPhiOperandPlace;

  const storeLocalReturn = createTemporaryPlace(
    fn.env,
    singlePhi.place.identifier.loc,
  );

  fallthroughBlock.instructions.unshift({
    id: makeInstructionId(0),
    lvalue: storeLocalReturn,
    value: {
      kind: 'StoreLocal',
      lvalue: {
        place: {...originalPhiReturn},
        kind: InstructionKind.Reassign,
      },
      type: null,
      value: {...temporaryPhiOperandPlace},
      loc: singlePhi.place.identifier.loc,
    },
    loc: singlePhi.place.identifier.loc,
  });
}
