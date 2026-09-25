import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

// The admitted candidate already contains the statistics/header slice. Compare
// to that exact tree, not an older feature-specific UI baseline.
const base = 'e3b3c5fc283eb4c41d7974d29f616588b809cd27';
const files = ['src/App.tsx', 'src/EditModals.tsx', 'src/Management.tsx', 'src/itinerary/ShipItineraryPortal.tsx', 'src/itinerary/ItineraryEditor.tsx'];
const printer = ts.createPrinter();
function renderedRoots(file, text) {
  // Git-clean LF and Windows working CRLF encode the same rendered text.
  const source = ts.createSourceFile(file, text.replaceAll('\r\n', '\n'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = ts.transform(source, [context => root => {
    const visit = node => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        const attrs = node.attributes.properties.filter(attr => {
          if (!ts.isJsxAttribute(attr)) return true;
          const name = attr.name.getText(source);
          // Only these internal callback seams change. All existing controls,
          // labels, classes, ordering and other properties remain exact.
          if (file === 'src/App.tsx' && tag === 'TaskEditModal' && name === 'closeConfirmedMember') return false;
          const vesselSelect = file.endsWith('ShipItineraryPortal.tsx') && tag === 'select' && node.attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText(source) === 'id' && p.initializer?.getText(source) === '"ship-vessel-select"');
          return !(vesselSelect && name === 'onChange');
        });
        const updated = ts.isJsxOpeningElement(node)
          ? context.factory.updateJsxOpeningElement(node, node.tagName, node.typeArguments, context.factory.updateJsxAttributes(node.attributes, attrs))
          : context.factory.updateJsxSelfClosingElement(node, node.tagName, node.typeArguments, context.factory.updateJsxAttributes(node.attributes, attrs));
        return ts.visitEachChild(updated, visit, context);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit);
  }]);
  const roots = [];
  const collect = n => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
      roots.push(printer.printNode(ts.EmitHint.Unspecified, n, source));
      return;
    }
    ts.forEachChild(n, collect);
  };
  collect(result.transformed[0]);
  result.dispose();
  return roots;
}
for (const file of files) {
  const before = execFileSync('git', ['show', `${base}:${file}`], {encoding:'utf8'});
  const after = fs.readFileSync(file, 'utf8');
  assert.deepEqual(renderedRoots(file, after), renderedRoots(file, before), file + ' exact JSX roots except named internal callbacks');
}
const paths = execFileSync('git', ['diff', '--name-only', base, '--', '*.css', 'src/main.tsx', 'index.html', 'ship-itinerary.html', 'supabase'], {encoding:'utf8'}).trim();
assert.equal(paths, '', 'CSS, mounted entrypoints and all SQL remain unchanged from admitted index');
console.log(JSON.stringify({status:'PASS',base,layer:'exact-source-JSX-boundary; not pixel parity',files,allowedInternalAttributes:['TaskEditModal.closeConfirmedMember','ship-vessel-select.onChange'],sqlAndStylesUnchanged:true}));
