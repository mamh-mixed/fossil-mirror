/*
 * This script adds multiselect facility for the list of branches.
 *
 * Some info on 'const':
 *   https://caniuse.com/const
 *   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/const#browser_compatibility
 *
 * According to MDN 'const' requires Android's WebView 37,
 * which may not be available.
 * For the time being, continueing without 'const' and 'indexOf'
 * (but that may be reconsidered later).
*/
window.addEventListener( 'load', function() {

var anchor = document.querySelector("div.submenu > a.label" );
if( !anchor || anchor.innerText != "Timeline" ) return;
var prefix   = anchor.href.toString() + "?ms=regexp&rel&t=";
anchor.classList.add('timeline-link');

var onChange = function( event ){
  var cbx = event.target;
  var tr  = cbx.parentElement.parentElement;
  var tag = cbx.parentElement.children[0].innerText;
  var re  = anchor.href.substr(prefix.length);
  var selected = ( re != "" ? re.split("|") : [] );
  if( cbx.checked ){
    selected.push(tag);
    tr.classList.add('selected');
  }
  else {
    tr.classList.remove('selected');
    for( var i = selected.length; --i >= 0 ;)
      if( selected[i] == tag )
        selected.splice(i,1);
  }
  if( selected.length >= 2 )
    anchor.classList.add('selected');
  else
    anchor.classList.remove('selected');

  anchor.href = prefix + selected.join("|");
  anchor.innerHTML = "View " + selected.length + " branches";
  // console.log("Link:",anchor.href);
}

var stags = []; /* initially selected tags, not used above */
document.querySelectorAll("div.brlist > table td:first-child > input")
  .forEach( function( cbx ){
    cbx.onchange = onChange;
    cbx.disabled = false;
    if( cbx.checked ){
      stags.push(cbx.parentElement.children[0].innerText);
      cbx.parentElement.parentElement.classList.add('selected');
    }
  });

if( stags.length != 0 ){
  anchor.href =  prefix + stags.join("|");
  if( stags.length >= 2 ) {
    anchor.innerHTML = "View " + stags.length + " branches";
    anchor.classList.add('selected');
  }
}

}); // window.addEventListener( 'load' ...