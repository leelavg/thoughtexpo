;(function () {
  window.gc_params = {
    graphcomment_id: 'thoughtexpo',
  }
  function getComments() {
    var gc = document.createElement('script')
    gc.type = 'text/javascript'
    gc.async = true
    gc.src =
      'https://graphcomment.com/js/integration.js?' +
      Math.round(Math.random() * 1e8)
    ;(
      document.getElementsByTagName('head')[0] ||
      document.getElementsByTagName('body')[0]
    ).appendChild(gc)
  }
  var comment = document.getElementById('comment')
  if (comment) {
    comment.addEventListener('click', function () {
      var graphComment = document.getElementById('graphcomment')
      var isCommentLoaded = document.getElementById('gc-iframe')
      if (graphComment.style.display == 'block') {
        graphComment.style.display = 'none'
      } else if (graphComment.style.display == 'none') {
        graphComment.style.display = 'block'
      }
      if (!isCommentLoaded) {
        getComments()
        graphComment.style.display = 'block'
      }
    })
  }
})()
