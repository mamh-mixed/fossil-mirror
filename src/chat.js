/**
   This file contains the client-side implementation of fossil's /chat
   application. 
*/
(function(){
  const form = document.querySelector('#chat-form');
  const F = window.fossil, D = F.dom;
  const Chat = (function(){
    const cs = {
      e:{/*map of certain DOM elements.*/
        messageInjectPoint: document.querySelector('#message-inject-point'),
        pageTitle: document.querySelector('head title'),
        loadToolbar: undefined /* the load-posts toolbar (dynamically created) */
      },
      me: F.user.name,
      mxMsg: F.config.chatInitSize ? -F.config.chatInitSize : -50,
      mnMsg: undefined/*lowest message ID we've seen so far (for history loading)*/,
      pageIsActive: 'visible'===document.visibilityState,
      changesSincePageHidden: 0,
      notificationBubbleColor: 'white',
      totalMessageCount: 0, // total # of inbound messages
      //! Number of messages to load for the history buttons
      loadMessageCount: Math.abs(F.config.chatInitSize || 20),
      ajaxInflight: 0,
      /** Enables (if yes is truthy) or disables all elements in
       * this.disableDuringAjax. */
      enableAjaxComponents: function(yes){
        D[yes ? 'enable' : 'disable'](this.disableDuringAjax);
        return this;
      },
      /* Must be called before any API is used which starts ajax traffic.
         If this call represents the currently only in-flight ajax request,
         all DOM elements in this.disableDuringAjax are disabled.
         We cannot do this via a central API because (1) window.fetch()'s
         Promise-based API seemingly makes that impossible and (2) the polling
         technique holds ajax requests open for as long as possible. A call
         to this method obligates the caller to also call ajaxEnd().

         This must NOT be called for the chat-polling API except, as a
         special exception, the very first one which fetches the
         initial message list.
      */
      ajaxStart: function(){
        if(1===++this.ajaxInflight){
          this.enableAjaxComponents(false);
        }
      },
      /* Must be called after any ajax-related call for which
         ajaxStart() was called, regardless of success or failure. If
         it was the last such call (as measured by calls to
         ajaxStart() and ajaxEnd()), elements disabled by a prior call
         to ajaxStart() will be re-enabled. */
      ajaxEnd: function(){
        if(0===--this.ajaxInflight){
          this.enableAjaxComponents(true);
        }
      },
      disableDuringAjax: [
        /* List of DOM elements disable while ajax traffic is in
           transit. Must be populated before ajax starts. We do this
           to avoid various race conditions in the UI and long-running
           network requests. */
      ],
      /* Injects element e as a new row in the chat, at the top of the
         list if atEnd is falsy, else at the end of the list, before
         the load-history widget. */
      injectMessageElem: function f(e, atEnd){
        const mip = atEnd ? this.e.loadToolbar : this.e.messageInjectPoint;
        if(atEnd){
          mip.parentNode.insertBefore(e, mip);
        }else{
          if(mip.nextSibling){
            mip.parentNode.insertBefore(e, mip.nextSibling);
          }else{
            mip.parentNode.appendChild(e);
          }
        }
      }
    };
    cs.pageTitleOrig = cs.e.pageTitle.innerText;
    const qs = (e)=>document.querySelector(e);
    const argsToArray = function(args){
      return Array.prototype.slice.call(args,0);
    };
    cs.reportError = function(/*msg args*/){
      const args = argsToArray(arguments);
      console.error("chat error:",args);
      F.toast.error.apply(F.toast, args);
    };

    cs.getMessageElemById = function(id){
      return qs('[data-msgid="'+id+'"]');
    };
    /**
       LOCALLY deletes a message element by the message ID or passing
       the .message-row element. Returns true if it removes an element,
       else false.
    */
    cs.deleteMessageElem = function(id){
      var e;
      if(id instanceof HTMLElement){
        e = id;
        id = e.dataset.msgid;
      }else{
        e = this.getMessageElemById(id);
      }
      if(e && id){
        D.remove(e);
        F.toast.message("Deleted message "+id+".");
      }
      return !!e;
    };

    /** Given a .message-row element, this function returns whethe the
        current user may, at least hypothetically, delete the message
        globally.  A user may always delete a local copy of a
        post. The server may trump this, e.g. if the login has been
        cancelled after this page was loaded.
    */
    cs.userMayDelete = function(eMsg){
      return this.me === eMsg.dataset.xfrom
        || F.user.isAdmin/*will be confirmed server-side*/;
    };

    /**
       Removes the given message ID from the local chat record and, if
       the message was posted by this user OR this user in an
       admin/setup, also submits it for removal on the remote.

       id may optionally be a DOM element, in which case it must be a
       .message-row element.
    */
    cs.deleteMessage = function(id){
      var e;
      if(id instanceof HTMLElement){
        e = id;
        id = e.dataset.msgid;
      }else{
        e = this.getMessageElemById(id);
      }
      if(!(e instanceof HTMLElement)) return;
      if(this.userMayDelete(e)){
        this.ajaxStart();
        fetch("chat-delete?name=" + id)
          .then(()=>this.deleteMessageElem(e))
          .catch(err=>this.reportError(err))
          .finally(()=>this.ajaxEnd());
      }else{
        this.deleteMessageElem(id);
      }
    };
    document.addEventListener('visibilitychange', function(ev){
      cs.pageIsActive = !document.hidden;
      if(cs.pageIsActive){
        cs.e.pageTitle.innerText = cs.pageTitleOrig;
      }
    }, true);
    return cs;
  })()/*Chat initialization*/;
  /* State for paste and drag/drop */
  const BlobXferState = {
    dropDetails: document.querySelector('#chat-drop-details'),
    blob: undefined
  };
  /** Updates the paste/drop zone with details of the pasted/dropped
      data. The argument must be a Blob or Blob-like object (File) or
      it can be falsy to reset/clear that state.*/
  const updateDropZoneContent = function(blob){
    const bx = BlobXferState, dd = bx.dropDetails;
    bx.blob = blob;
    D.clearElement(dd);
    if(!blob){
      form.file.value = '';
      return;
    }
    D.append(dd, "Name: ", blob.name,
             D.br(), "Size: ",blob.size);
    if(blob.type && blob.type.startsWith("image/")){
      const img = D.img();
      D.append(dd, D.br(), img);
      const reader = new FileReader();
      reader.onload = (e)=>img.setAttribute('src', e.target.result);
      reader.readAsDataURL(blob);
    }
    const btn = D.button("Cancel");
    D.append(dd, D.br(), btn);
    btn.addEventListener('click', ()=>updateDropZoneContent(), false);
  };
  form.file.addEventListener('change', function(ev){
    //console.debug("this =",this);
    updateDropZoneContent(this.files && this.files[0] ? this.files[0] : undefined)
  });

  form.addEventListener('submit',(e)=>{
    e.preventDefault();
    const fd = new FormData(form);
    if(BlobXferState.blob/*replace file content with this*/){
      fd.set("file", BlobXferState.blob);
    }
    if( form.msg.value.length>0 || form.file.value.length>0 || BlobXferState.blob ){
      fetch("chat-send",{
        method: 'POST',
        body: fd
      });
    }
    BlobXferState.blob = undefined;
    D.clearElement(BlobXferState.dropDetails);
    form.msg.value = "";
    form.file.value = "";
    form.msg.focus();
  });
  /* Handle image paste from clipboard. TODO: figure out how we can
     paste non-image binary data as if it had been selected via the
     file selection element. */
  document.onpaste = function(event){
    const items = event.clipboardData.items,
          item = items[0];
    if(!item || !item.type) return;
    else if('file'===item.kind){
      updateDropZoneContent(false/*clear prev state*/);
      updateDropZoneContent(items[0].getAsFile());
    }else if(false && 'string'===item.kind){
      /* ----^^^^^ disabled for now: the intent here is that if
         form.msg is not active, populate it with this text, but
         whether populating it from ctrl-v when it does not have focus
         is a feature or a bug is debatable.  It seems useful but may
         violate the Principle of Least Surprise. */
      if(document.activeElement !== form.msg){
        /* Overwrite input field if it DOES NOT have focus,
           otherwise let it do its own paste handling. */
        item.getAsString((v)=>form.msg.value = v);
      }
    }
  };
  if(true){/* Add help button for drag/drop/paste zone */
    form.file.parentNode.insertBefore(
      F.helpButtonlets.create(
        document.querySelector('#chat-input-file-area .help-buttonlet')
      ), form.file
    );
  }
  ////////////////////////////////////////////////////////////
  // File drag/drop visual notification.
  const dropHighlight = form.file /* target zone */;
  const dropEvents = {
    drop: function(ev){
      D.removeClass(dropHighlight, 'dragover');
    },
    dragenter: function(ev){
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
      D.addClass(dropHighlight, 'dragover');
    },
    dragleave: function(ev){
      D.removeClass(dropHighlight, 'dragover');
    },
    dragend: function(ev){
      D.removeClass(dropHighlight, 'dragover');
    }
  };
  Object.keys(dropEvents).forEach(
    (k)=>form.file.addEventListener(k, dropEvents[k], true)
  );

  /* Returns a new TEXT node with the given text content. */
  /** Returns the local time string of Date object d, defaulting
      to the current time. */
  const localTimeString = function ff(d){
    if(!ff.pad){
      ff.pad = (x)=>(''+x).length>1 ? x : '0'+x;
    }
    d || (d = new Date());
    return [
      d.getFullYear(),'-',ff.pad(d.getMonth()+1/*sigh*/),
      '-',ff.pad(d.getDate()),
      ' ',ff.pad(d.getHours()),':',ff.pad(d.getMinutes()),
      ':',ff.pad(d.getSeconds())
    ].join('');
  };
  /* Returns an almost-ISO8601 form of Date object d. */
  const iso8601ish = function(d){
    return d.toISOString()
      .replace('T',' ').replace(/\.\d+/,'').replace('Z', ' GMT');
  };
  /* Event handler for clicking .message-user elements to show their
     timestamps. */
  const handleLegendClicked = function f(ev){
    if(!f.popup){
      /* Timestamp popup widget */
      f.popup = new F.PopupWidget({
        cssClass: ['fossil-tooltip', 'chat-message-popup'],
        refresh:function(){
          const eMsg = this._eMsg;
          if(!eMsg) return;
          D.clearElement(this.e);
          const d = new Date(eMsg.dataset.timestamp+"Z");
          if(d.getMinutes().toString()!=="NaN"){
            // Date works, render informative timestamps
            D.append(this.e,
                     D.append(D.span(), localTimeString(d)," client-local"),
                     D.append(D.span(), iso8601ish(d)));
           }else{
            // Date doesn't work, so dumb it down...
            D.append(this.e, D.append(D.span(), eMsg.dataset.timestamp," GMT"));
          }
          const toolbar = D.addClass(D.div(), 'toolbar');
          D.append(this.e, toolbar);
          const btnDeleteLocal = D.button("Delete locally");
          D.append(toolbar, btnDeleteLocal);
          const self = this;
          btnDeleteLocal.addEventListener('click', function(){
            console.debug("local-only delete");
            self.hide();
            Chat.deleteMessageElem(eMsg);
          });
          if(Chat.userMayDelete(eMsg)){
            const btnDeleteGlobal = D.button("Delete globally");
            D.append(toolbar, btnDeleteGlobal);
            btnDeleteGlobal.addEventListener('click', function(){
              console.debug("global delete");
              self.hide();
              Chat.deleteMessage(eMsg);
            });
          }
        }/*refresh()*/
      });
      f.popup.installClickToHide();
      f.popup.hide = function(){
        delete this._eMsg;
        D.clearElement(this.e);
        return this.show(false);
      };
    }/*end static init*/
    const rect = ev.target.getBoundingClientRect();
    const eMsg = ev.target.parentNode/*the owning fieldset element*/;
    f.popup._eMsg = eMsg;
    let x = rect.left, y = rect.top - 10;
    f.popup.show(ev.target)/*so we can get its computed size*/;
    if('right'===ev.target.getAttribute('align')){
      // Shift popup to the left for right-aligned messages to avoid
      // truncation off the right edge of the page.
      const pRect = f.popup.e.getBoundingClientRect();
      x -= pRect.width/3*2;
    }
    f.popup.show(x, y);
  }/*handleLegendClicked()*/;

  /** Callback for poll() to inject new content into the page.  jx ==
      the response from /chat-poll. If atEnd is true, the message is
      appended to the end of the chat list, else the beginning (the
      default). */
  const newcontent = function f(jx,atEnd){
    if(!f.processPost){
      /** Processes chat message m, placing it either the start (if atEnd
          is falsy) or end (if atEnd is truthy) of the chat history. atEnd
          should only be true when loading older messages. */
      f.processPost = function(m,atEnd){
        ++Chat.totalMessageCount;
        if( m.msgid>Chat.mxMsg ) Chat.mxMsg = m.msgid;
        if( !Chat.mnMsg || m.msgid<Chat.mnMsg) Chat.mnMsg = m.msgid;
        if( m.mdel ){
          /* A record deletion notice. */
          Chat.deleteMessageElem(m.mdel);
          return;
        }
        const eWho = D.create('legend'),
              row = D.addClass(D.fieldset(eWho), 'message-row');
        row.dataset.msgid = m.msgid;
        row.dataset.xfrom = m.xfrom;
        row.dataset.timestamp = m.mtime;
        Chat.injectMessageElem(row,atEnd);
        eWho.addEventListener('click', handleLegendClicked, false);
        if( m.xfrom==Chat.me && window.outerWidth<1000 ){
          eWho.setAttribute('align', 'right');
          row.style.justifyContent = "flex-end";
        }else{
          eWho.setAttribute('align', 'left');
        }
        eWho.style.backgroundColor = m.uclr;
        eWho.classList.add('message-user');
        let whoName = m.xfrom;
        var d = new Date(m.mtime + "Z");
        if( d.getMinutes().toString()!="NaN" ){
          /* Show local time when we can compute it */
          eWho.append(D.text(whoName+' @ '+
                             d.getHours()+":"+(d.getMinutes()+100).toString().slice(1,3)
                            ))
        }else{
          /* Show UTC on systems where Date() does not work */
          eWho.append(D.text(whoName+' @ '+m.mtime.slice(11,16)))
        }
        let eContent = D.addClass(D.div(),'message-content','chat-message');
        eContent.style.backgroundColor = m.uclr;
        row.appendChild(eContent);
        if( m.fsize>0 ){
          if( m.fmime && m.fmime.startsWith("image/") ){
            eContent.appendChild(D.img("chat-download/" + m.msgid));
          }else{
            eContent.appendChild(D.a(
              window.fossil.rootPath+
                'chat-download/' + m.msgid+'/'+encodeURIComponent(m.fname),
              // ^^^ add m.fname to URL to cause downloaded file to have that name.
              "(" + m.fname + " " + m.fsize + " bytes)"
            ));
          }
          const br = D.br();
          br.style.clear = "both";
          eContent.appendChild(br);
        }
        if(m.xmsg){
          // The m.xmsg text comes from the same server as this script and
          // is guaranteed by that server to be "safe" HTML - safe in the
          // sense that it is not possible for a malefactor to inject HTML
          // or javascript or CSS.  The m.xmsg content might contain
          // hyperlinks, but otherwise it will be markup-free.  See the
          // chat_format_to_html() routine in the server for details.
          //
          // Hence, even though innerHTML is normally frowned upon, it is
          // perfectly safe to use in this context.
          eContent.innerHTML += m.xmsg
        }
      }/*processPost()*/;
    }/*end static init*/
    jx.msgs.forEach((m)=>f.processPost(m,atEnd));
    if('visible'===document.visibilityState){
      if(Chat.changesSincePageHidden){
        Chat.changesSincePageHidden = 0;
        Chat.e.pageTitle.innerText = Chat.pageTitleOrig;
      }
    }else{
      Chat.changesSincePageHidden += jx.msgs.length;
      Chat.e.pageTitle.innerText = '('+Chat.changesSincePageHidden+') '+
        Chat.pageTitleOrig;
    }
    if(jx.msgs.length && F.config.pingTcp){
      fetch("http:/"+"/localhost:"+window.fossil.config.pingTcp+"/chat-ping");
    }
  }/*newcontent()*/;

  if(true){
    /** Add toolbar for loading older messages. We use a FIELDSET here
        because a fieldset is the only parent element type which can
        automatically enable/disable its children by
        enabling/disabling the parent element. */
    const loadLegend = D.legend("Load...");
    const toolbar = Chat.e.loadToolbar = D.addClass(
      D.fieldset(loadLegend), "load-msg-toolbar"
    );
    Chat.disableDuringAjax.push(toolbar);
    /* Loads the next n oldest messages, or all previous history if n is negative. */
    const loadOldMessages = function(n){
      Chat.ajaxStart();
      var gotMessages = false;
      fetch("chat-poll?before="+Chat.mnMsg+"&n="+n)
        .then(x=>x.json())
        .then(function(x){
          gotMessages = x.msgs.length;
          newcontent(x,true);
        })
        .catch(e=>Chat.reportError(e))
        .finally(function(){
          if(n<0/*we asked for all history*/
             || 0===gotMessages/*we found no history*/
             || (n>0 && gotMessages<n /*we got fewer history entries than requested*/)
             || (false!==gotMessages && n<0 && gotMessages<Chat.loadMessageCount
                 /*we asked for default amount and got fewer than that.*/)){
            /* We've loaded all history. Permanently disable the
               history-load toolbar and keep it from being re-enabled
               via the ajaxStart()/ajaxEnd() mechanism... */
            const div = Chat.e.loadToolbar.querySelector('div');
            D.append(D.clearElement(div), "All history has been loaded.");
            D.addClass(Chat.e.loadToolbar, 'all-done');
            const ndx = Chat.disableDuringAjax.indexOf(Chat.e.loadToolbar);
            if(ndx>=0) Chat.disableDuringAjax.splice(ndx,1);
            Chat.e.loadToolbar.disabled = true;
          }
          if(gotMessages > 0){
            F.toast.message("Loaded "+gotMessages+" older messages.");
          }
          Chat.ajaxEnd();
        });
    };
    const wrapper = D.div(); /* browsers don't all properly handle >1 child in a fieldset */;
    D.append(toolbar, wrapper);
    var btn = D.button("Previous "+Chat.loadMessageCount+" messages");
    D.append(wrapper, btn);
    btn.addEventListener('click',()=>loadOldMessages(Chat.loadMessageCount));
    btn = D.button("All previous messages");
    D.append(wrapper, btn);
    btn.addEventListener('click',()=>loadOldMessages(-1));
    D.append(document.querySelector('body.chat > div.content'), toolbar);
      toolbar.disabled = true /*will be enabled when msg load finishes */;
  }/*end history loading widget setup*/

  async function poll(isFirstCall){
    if(poll.running) return;
    poll.running = true;
    if(isFirstCall) Chat.ajaxStart();
    var p = fetch("chat-poll?name=" + Chat.mxMsg);
    p.then(x=>x.json())
      .then(y=>newcontent(y))
      .catch(e=>Chat.reportError(e))
      .finally(function(x){
        if(isFirstCall) Chat.ajaxEnd();
        poll.running=false;
      });
  }
  poll.running = false;
  poll(true);
  setInterval(poll, 1000);
  F.page.chat = Chat/* enables testing the APIs via the dev tools */;
})();