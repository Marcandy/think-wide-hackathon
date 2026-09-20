# Ticket seeds and the pull queue

These are planning seeds, not a live board and not claims that any work has started. Instantiate only the ready first wave as GitHub Issues after the repo/build is authorized. PM_BOOT.md governs claims, evidence, and changes.

## First wave

Eassa: G0 then T01 and T02. Marc: T03 as soon as the actual root skeleton/design handoff is published. Andrew: T04 at the same point. Nobody waits for a finished hosted backend.

Next, publish evidence/decision interfaces and pull T05/T06/T07 in parallel as their actual inputs are available. T07 can prepare trusted rule fixtures before T05 lands, but cannot close without the real source mapping. T08 gives agents an early useful tool surface. T09/T10 assemble the product; T11 preserves its first complete recording.

I01 and I04 are high-priority connection integrations, not decorative stretch goals. One useful capacity transfer: after T07, Andrew can take the thin T08 adapter while Eassa tackles I01, with Eassa reviewing the adapter and Andrew reviewing identity. Schedule their initial checks early and reserve time; do not delay T03/T04 or the local core while they block. I02/I03/I05 are optional and only start with spare capacity before their cutoffs. Skipping I04 means remote ChatGPT/Claude.ai use remains incomplete, not silently removed from the goal.

## Queue

| ID | Deliverable | Suggested owner | Timebox | Hard stop EDT | Prerequisites | Class |
|---|---|---|---|---|---|---|
| [G0](tickets/G0.md) | Confirm the event boundary and first acceptance | Eassa | 10 min | 11:25 | None | core |
| [T01](tickets/T01.md) | Initialize the single shared checkout | Eassa | 20 min | 12:00 | G0 | core |
| [T02](tickets/T02.md) | Contract generation and local Convex | Eassa | 45 min | 12:30 | T01 | core |
| [T03](tickets/T03.md) | Theme and the real product component workshop | Marc | 35 min | 12:30 | T01 | core |
| [T04](tickets/T04.md) | Fixture and effect harness, not more scanner setup | Andrew | 40 min | 12:30 | T01 | core |
| [T05](tickets/T05.md) | Two Git snapshots, navigable map, and exact reads | Marc | 40 min | 13:30 | T02 | core |
| [T06](tickets/T06.md) | Protected investigation and decision transactions | Eassa | 35 min | 13:30 | T02, T04 | core |
| [T07](tickets/T07.md) | Literal plus bounded structural search | Andrew | 35 min | 14:15 | T02, T04 | core |
| [T08](tickets/T08.md) | Useful headless MCP tools, not just a ping | Eassa | 35 min | 14:00 | T05, T06 | core |
| [T09](tickets/T09.md) | Persistent workbench and implementation brief | Marc | 40 min | 14:15 | T05, T06 | core |
| [T10](tickets/T10.md) | One live reasoning driver and a real correction | Marc | 35 min | 15:00 | T07, T09 | core |
| [T11](tickets/T11.md) | First complete recording and integrated regressions | Andrew | 30 min | 15:00 | T08, T09, T10 | core |
| [I01](tickets/I01.md) | Managed identity through the actual backend | Eassa | 35 min | 14:30 | T06 | integration |
| [I02](tickets/I02.md) | Ergonomic selected-repository GitHub connection | Marc | 35 min | 14:15 | T05, I01 | optional |
| [I03](tickets/I03.md) | Approved GitHub issue publication | Marc | 25 min | 15:30 | T09, I01, I02 | optional |
| [I04](tickets/I04.md) | GalaxyGate deployment and one actual remote MCP host | Eassa | 35 min | 15:30 | T08, I01 | integration |
| [I05](tickets/I05.md) | Read a specialist outcome back into the map | Any qualified teammate | 25 min | 16:00 | T09, I02, T11 | optional |
| [F01](tickets/F01.md) | Feature freeze, retest, and final rehearsal | Andrew | 40 min | 16:30 | T11 | release |
| [F02](tickets/F02.md) | Submission, disclosure, and Code Registry handoff | Eassa | 30 min | 17:30 | F01 | release |

## No hidden dependency debt

A prerequisite must be an actual usable artifact, not an entire person's lane. Record the exact commit and remaining limitations when releasing a dependent ticket. Early skeleton/interface commits let fixture/theme work proceed; they do not imply an unfinished backend has passed tests.

A failed optional integration never makes the core ticket DONE by definition. Update its capabilities/claims explicitly. If there are more READY tasks than people, choose the task that unblocks the next clock checkpoint, then remote connectivity, then optional ergonomics.

Review work is real capacity. Prefer review/merge before starting another implementation. At most one active writer per human. Pairing or a second review agent does not create an extra implementation lane.

## Example issued-ticket conversation

"Next for Marc" → PM inspects current trunk, merges/checks/claims and clock → chooses a ready ticket → records owner and exact dependencies → provides its complete task body.

"Done T09 at <actual SHA>" → PM verifies diff, acceptance receipt and review → integrates and retests affected path → marks DONE → releases newly READY tickets.

"T08 blocked on installed export" → record package/export evidence → stop guessing → keep local validated interface or explicit unsupported result → another ready ticket. No compatibility patch made of any casts.
