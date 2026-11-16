// How the drawing meets a folded site, while the forms are weighed against one
// another. Internal: the package exports neither the forms nor the setter.
//
// reference
//   'A': the reference's own links meeting a folded site are stroked as the
//        reference is, at its nodes' thickness and colour
//   'B': they are stroked as any link is
// lane, with walks lifted
//   'A': no lane on a folded link, so a lane stops at the site's attachments
//   'B': a lane runs straight across the site over whatever reference lies
//        there
//   'C': every lifted walk crossing the site runs one straight lane between
//        its attachments, whichever route it takes, and the reference nodes
//        inside it are drawn only by those lanes
export interface FoldForms {
  reference: 'A' | 'B'
  lane: 'A' | 'B' | 'C'
}

let forms: FoldForms = { reference: 'B', lane: 'B' }

export const foldForms = () => forms

export function drawFoldsAs(next: Partial<FoldForms>) {
  forms = { ...forms, ...next }
}
