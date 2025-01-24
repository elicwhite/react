import {
  BasicBlock,
  computePostDominatorTree,
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
  {
    // debug ternary
    const blocks = Array.from(fn.body.blocks.values());
    // console.log(
    //   fn.body.blocks.get(
    //     // @ts-ignore
    //     blocks.filter(b => b.terminal.kind === 'ternary')[0].terminal
    //       .fallthrough!,
    //   )?.instructions,
    // );

    console.log(
      JSON.stringify(
        Array.from(fn.body.blocks.values()),
        (key, value) =>
          key === 'loc' || key === 'mutableRange' ? undefined : value,
        2,
      ),
    );
  }

  // TODO: Reassign the phi value to the stored value

  const ifBlocks = findAllIfs(fn);
  for (const ifBlock of ifBlocks) {
    convertIfBlock(fn, ifBlock);
  }

  reversePostorderBlocks(fn.body);
  markInstructionIds(fn.body);
  markPredecessors(fn.body);
  console.log(
    '-----------------------------------------------------------------',
  );
}

function findAllIfs(fn: HIRFunction): Array<BasicBlock> {
  const ifBlocks: Array<BasicBlock> = [];

  for (const stmt of fn.body.blocks.values()) {
    if (stmt.terminal.kind === 'if') {
      ifBlocks.push(stmt);
    }
  }

  return ifBlocks;
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

  // console.log(':::::::::::::::');
  // @ts-ignore
  // console.log(Array.from(fallthroughBlock.phis.values())[0].place.identifier);

  // Check if the phi postdominates the if

  /*
   * Replace StoreLocal Reassign with StoreLocal Const
   * Make the phi reference the new temporary variables instead of the named variables
   * Add a Branch block as the test of the if
   * Replace the if with a ternary pointing to the block
   */

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

  /*

  Before: 

  bb1 (block):
    predecessor blocks: bb2 bb3
    <unknown> result$28: phi(bb2: <unknown> $30, bb3: <unknown> $31)
    [15] <unknown> $29 = LoadLocal <unknown> result$28
    [16] Return <unknown> $29

  After:

  bb1 (block):
    predecessor blocks: bb3 bb4
    <unknown> $20: phi(bb3: <unknown> $15, bb4: <unknown> $18)
    [11] <unknown> $22 = StoreLocal Reassign <unknown> result$21 = <unknown> $20
    [12] <unknown> $23 = LoadLocal <unknown> result$21
    [13] Return <unknown> $23

    store the result of the phi (result$28)
    replace the result of the phi with new temporary $50
    Insert store local Reassign to result$28 = $50
  */

  const originalPhiReturn = singlePhi.place;

  const newPhiReturn = createTemporaryPlace(
    fn.env,
    singlePhi.place.identifier.loc,
  );
  singlePhi.place = newPhiReturn;

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
      value: {...newPhiReturn},
      loc: singlePhi.place.identifier.loc,
    },
    loc: singlePhi.place.identifier.loc,
  });

  // const loadLocalReturn = createTemporaryPlace(
  //   fn.env,
  //   singlePhi.place.identifier.loc,
  // );

  // const storeLocalReturn = createTemporaryPlace(
  //   fn.env,
  //   singlePhi.place.identifier.loc,
  // );

  // console.log(singlePhi);

  // fallthroughBlock.instructions.unshift({
  //   id: makeInstructionId(0),
  //   lvalue: storeLocalReturn,
  //   value: {
  //     kind: 'StoreLocal',
  //     lvalue: {
  //       place: {...originalPhiReturn},
  //       kind: InstructionKind.Reassign
  //     },
  //     value: {...phiReturn},
  //     loc: singlePhi.place.identifier.loc,
  //   },
  //   loc: singlePhi.place.identifier.loc,
  // });

  // fallthroughBlock.instructions.unshift({
  //   id: makeInstructionId(0),
  //   lvalue: loadLocalReturn,
  //   value: {
  //     kind: 'LoadLocal',
  //     place: phiReturn,
  //     loc: singlePhi.place.identifier.loc,
  //   },
  //   loc: singlePhi.place.identifier.loc,
  // });

  // Probably need to update any other instructions that used
  // the previous value to now use the new value
  for (const instruction of fallthroughBlock.instructions) {
    // console.log(instruction);
  }

  console.log('fallthrough terminal:');
  console.log(
    fallthroughBlock.terminal.kind === 'return' &&
      fallthroughBlock.terminal.value,
  );

  console.log('old value');
  console.log(originalPhiReturn);

  // console.log(fallthroughBlock);

  // console.log(singlePhi);

  // const postDominators = computePostDominatorTree(fn, {
  //   includeThrowsAsExitNode: true,
  // });

  // let current = ifBlock.id;

  // while (true) {
  //   const postDominator = postDominators.get(current);

  //   if (postDominator === fallthroughBlock.id) {
  //     // control always reaches the fallthrough
  //     break;
  //   } else if (postDominator === current) {
  //     // control diverges
  //     return;
  //   } else if (postDominator == null) {
  //     throw new Error('How did we get null here?');
  //   } else {
  //     current = postDominator;
  //   }
  // }

  // Create a new block for the ternary test.
  // Add that block to the program.
  // Get the ID of that block
  // Create a new TernaryTerminal, the test is the ID of that block
  // Replace the terminal of the ifBlock with the ternary terminal

  // const ifTestPlace = ifStatement.test;

  // ifTestPlace;
  // 2;

  // const newBlock = {
  //   kind: 'block',
  //   id: fn.env.nextBlockId,
  //   instructions: [],
  //   terminal: {
  //     kind: 'branch',
  //     test: ifTestPlace,
  //     consequent: ifStatement.consequent,
  //   },
  //   preds: new Set(),
  //   phis: new Set(),
  // };

  // const newBlock = {
  //   ...ifBlock,
  //   terminal: {
  //     kind: 'ternary',
  //     test: ifStatement.test,
  //     consequent: fn.body.blocks.get(ifStatement.consequent)!.terminal,
  //     alternate: fn.body.blocks.get(ifStatement.alternate)!.terminal,
  //   },
  // }

  // const newTerminal = {
  //   kind: 'ternary',
  //   test: ifStatement.test,
  //   consequent: fn.body.blocks.get(ifStatement.consequent)!.terminal,
  //   alternate: fn.body.blocks.get(ifStatement.alternate)!.terminal,
  // }

  // ifBlock.terminal = newTerminal

  // // the fallthrough does postdominate the if!
  // const testBlock = {
  //   kind: 'block',
  //   id: fn.env.nextBlockId,
  //   instructions: ifStatement.test.;
  //   terminal: Terminal;
  //   preds: Set<BlockId>;
  //   phis: Set<Phi>;
  // };

  // const ternary: TernaryTerminal = {
  //   kind: 'ternary',
  //   test: ifStatement.test,
  //   consequent: fn.body.blocks.get(ifStatement.consequent)!
  //     .terminal as GotoTerminal,
  //   alternate: fn.body.blocks.get(ifStatement.alternate)!
  //     .terminal as GotoTerminal,
  // };
  // // ifBlock.terminal = ternary;

  // console.log('test', areAllGoTos, fn.body.blocks.get(ifStatement.consequent));
}
