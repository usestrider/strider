/** Fixed-width words keep the same fragment counts on all pinned browsers. */
export const wrappedLinks = [
  { id: "one", fragments: 1, text: "one line control", pad: 0, tight: false, block: false },
  { id: "apart", fragments: 2, text: "View session", pad: 240, tight: false, block: false },
  {
    id: "overlap",
    fragments: 2,
    text: "abcdefgh abcdefgh abcdefgh abcdefgh abcdefgh",
    pad: 60,
    tight: false,
    block: false
  },
  {
    id: "tight",
    fragments: 2,
    text: "abcdefgh abcdefgh abcdefgh abcdefgh abcdefgh",
    pad: 60,
    tight: true,
    block: false
  },
  { id: "tightapart", fragments: 2, text: "View session", pad: 240, tight: true, block: false },
  { id: "three", fragments: 3, text: Array(6).fill("abcdefghij").join(" "), pad: 0, tight: false, block: false },
  { id: "four", fragments: 4, text: Array(8).fill("abcdefghij").join(" "), pad: 0, tight: false, block: false },
  { id: "block", fragments: 1, text: Array(4).fill("abcdefghij").join(" "), pad: 0, tight: false, block: true }
] as const

export const wrappedLinkHtml = (shape: typeof wrappedLinks[number], partial = false) =>
  `<!doctype html>
<style>body{margin:8px;font:16px/1.5 monospace}.box{width:300px;transform:translateX(.25px);${
    partial ? "position:fixed;top:-30px" : ""
  }}a{${shape.block ? "display:inline-block" : ""}}</style>
<div class="box" style="line-height:${shape.tight ? 1 : 1.5}">${
    shape.pad ? `<span style="display:inline-block;width:${shape.pad}px;height:1px"></span>` : ""
  }<a id="go" href="#go">${shape.text}</a></div><output id="out"></output>
<script>document.addEventListener('pointerdown', e => out.textContent = JSON.stringify({target:e.target.id,x:e.clientX,y:e.clientY}));document.addEventListener('click',e=>{e.preventDefault();out.dataset.clicked=e.target.id})</script>`

/** JSON so the adapter and public API can read the same geometry. */
export const linkGeometry =
  `() => JSON.stringify({rects:Array.from(document.querySelector('#go').getClientRects(), r => ({left:r.left,top:r.top,right:r.right,bottom:r.bottom})),width:innerWidth,height:innerHeight})`

export interface LinkGeometry {
  readonly rects: ReadonlyArray<
    { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
  >
  readonly width: number
  readonly height: number
}
