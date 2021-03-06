/**
`sortable-list`


@demo demo/index.html
*/
/*
  FIXME(polymer-modulizer): the above comments were extracted
  from HTML and may be out of place here. Review them and
  then delete this comment!
*/
import { PolymerElement } from '@polymer/polymer/polymer-element.js';

import { GestureEventListeners } from '@polymer/polymer/lib/mixins/gesture-event-listeners.js';
import { html } from '@polymer/polymer/lib/utils/html-tag.js';
import { idlePeriod } from '@polymer/polymer/lib/utils/async.js';
import { addListener, removeListener } from '@polymer/polymer/lib/utils/gestures.js';
import '@webcomponents/shadycss/apply-shim.min';

class SortableList extends GestureEventListeners(PolymerElement) {
  static get template() {
    return html`
    <style>
      :host {
        display: inline-block;
      }

      #items ::slotted(*) {
        user-drag: none;
        user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
        -webkit-user-drag: none;
        -webkit-user-select: none;
        -webkit-tap-highlight-color: rgba(255, 255, 255, 0);
      }

      #items ::slotted(.item--transform) {
        left: 0;
        margin: 0 !important;
        position: absolute !important;
        top: 0;
        transition: transform 0.2s cubic-bezier(0.333, 0, 0, 1);
        will-change: transform;
        z-index: 1;
      }

      #items ::slotted(.item--pressed) {
        transition: none !important;
      }

      #items ::slotted(.item--dragged) {
        -webkit-box-shadow: 0 2px 10px rgba(0,0,0,.2);
        box-shadow: 0 2px 10px rgba(0,0,0,.2);
        filter: brightness(1.1);
        z-index: 2;
      }
      
      #items {
        display: flex;
        flex-wrap: wrap;
        flex-direction: row;
        justify-content: left;
        @apply --sortable-list-container;

        /* needs to be positioned */        
        position: relative;
      }
    </style>
    
    <div id="items">
      <slot id="slot"></slot>
    </div>
`;
  }

  static get is() {return 'sortable-list';}

  static get properties() {
    return {

      /**
       * This is a CSS selector string. If this is set, only items that 
       * match the CSS selector are sortable.
       */
      sortable: String,

      /**
       * The list of sortable items.
       */
      items: {
        type: Array,
        notify: true,
        readOnly: true
      },

      /**
      * Returns true when an item is being drag.
      */
      dragging: {
        type: Boolean,
        notify: true,
        readOnly: true,
        reflectToAttribute: true,
        value: false
      },

      /**
      * Scroll vertically if necessary
      */
      scroll: {
        type: Boolean,
        reflectToAttribute: true,
        value: false
      },

      /**
      * Scrolling speed. Its the quantity of pixels the page is scrolled per frame (requestAnimationFrame).
      */
      scrollingSpeed: {
        type: Number,
        value: 6
      },

      /**
       * Disables the draggable if set to true.
       */
      disabled: {
        type: Boolean,
        reflectToAttribute: true,
        value: false
      }

    };
  }

  constructor() {
    super();
    this._observer = null;
    this._target = null;
    this._targetRect = null;
    this._rects = null;
    this._onTrack = this._onTrack.bind(this);
    this._onDragStart = this._onDragStart.bind(this);
    this._onTransitionEnd = this._onTransitionEnd.bind(this);
    this._onContextMenu = this._onContextMenu.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);

    this._scroll = this._scroll.bind(this);

    this._directionBuffer = [];
  }

  connectedCallback() {
    super.connectedCallback();
    idlePeriod.run(_ => {
      this._observeItems();
      this._updateItems();
      this._toggleListeners({enable: true});
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unobserveItems();
    this._toggleListeners({enable: false});
  }

  _toggleListeners({enable}) {
    const m = enable ? 'addEventListener' : 'removeEventListener';
    this.$.items[m]('dragstart', this._onDragStart);
    this.$.items[m]('transitionend', this._onTransitionEnd);
    this.$.items[m]('contextmenu', this._onContextMenu);
    this.$.items[m]('touchmove', this._onTouchMove);
    if (enable) {
      addListener(this, 'track', this._onTrack);
    } else {
      removeListener(this, 'track', this._onTrack);
    }
  }

  _onTrack(event) {
    switch(event.detail.state) {
      case 'start': this._trackStart(event); break;
      case 'track': this._track(event); break;
      case 'end': this._trackEnd(event); break;
    }
  }

  _trackStart(event) {
    if (this.disabled || this._animatingElementsToNaturalPosition) {
      return;
    }
    this._target = this._itemFromEvent(event);
    if (!this._target) {
      return;
    }
    event.stopPropagation();
    this._computedStyle = window.getComputedStyle(this);
    this._rects = this._getItemsRects();
    this._targetRect = this._rects[this.items.indexOf(this._target)];
    this._target.classList.add('item--dragged', 'item--pressed');
    if ('vibrate' in navigator) {
      navigator.vibrate(30);
    }
    const rect = this.getBoundingClientRect();
    this._containerPaddingAndMarginTop = parseFloat(this._computedStyle.borderTopWidth) + parseFloat(this._computedStyle.paddingTop);
    this._containerPaddingAndMarginBottom = parseFloat(this._computedStyle.borderBottomWidth) + parseFloat(this._computedStyle.paddingBottom);

    this.style.height = this._computedStyle.height;
    this.style.width = this._computedStyle.width;
    this.items.forEach((item, idx) => {
      const rect = this._rects[idx];
      item.classList.add('item--transform');
      item.style.transition = 'none';
      item.__originalWidth = item.style.width;
      item.__originalHeight = item.style.height;
      item.style.width = rect.width + 'px';
      item.style.height = rect.height + 'px';
      this._translate3d(rect.left, rect.top, 1, item);
      setTimeout(_ => {
        item.style.transition = null;
      }, 20);
    });
    this._setDragging(true);
  }

  _track(event) {
    if (!this.dragging) {
      return;
    }

    const containerRect = this.getBoundingClientRect();
    const targetRect = this._target.getBoundingClientRect();

    // updates the target's position to the users finger position while dragging and possibly scrolling
    const targetNewYPosition = (targetRect.top - this._containerPaddingAndMarginTop) - containerRect.top + event.detail.ddy;

    const containerHeight = this.offsetHeight;
    const viewportHeight = window.innerHeight;

    // Dragging and scrolling is a very tricky too control, since the dragging could move horizontally and vetically and scroll (all at the same time!)
    // we need to share a variable to control the X position of the transform of the dragging target.
    this.__targetNewXPosition =  this._targetRect.left + event.detail.dx + event.detail.ddx;

    if (this.scroll) {

      const targetRectRelativeToContainer = {
        top: targetRect.top - this._containerPaddingAndMarginTop - containerRect.top,
        bottom: targetRect.bottom - this._containerPaddingAndMarginBottom - containerRect.top
      };

      const UPWARDS = -1;
      const DOWNWARDS = 1;

      if (event.detail.ddy < 0) {
        this._directionBuffer.push(UPWARDS);

        if (this._currentScrollDirection === DOWNWARDS && this._dragDirectionPurposelyChanged(UPWARDS)) { // if we were just scrolling downwards, than interrupt the scroll
          this._cancelRunningScroll();
        }

        // if the top of the container is still not reached and there isn't a running scroll animation, we can still scroll up
        if (containerRect.top < 0 && targetRect.top <= 0 && !this._rafID) {
          this._scroll(-Math.abs(targetRectRelativeToContainer.top)); // ensure a negative value as argument
        }

      } else if (event.detail.ddy > 0) { // sometimes ddy===0 while dragging, thats why there is an else if
        this._directionBuffer.push(DOWNWARDS);

        if (this._currentScrollDirection === UPWARDS && this._dragDirectionPurposelyChanged(DOWNWARDS)) { // if we were just scrolling upwards, than interrupt the scroll
            this._cancelRunningScroll();
        }

        // if the bottom of the container is still not reached and there isn't a running scroll animation, we can still scroll down
        if (containerRect.bottom > viewportHeight && targetRect.bottom >= viewportHeight && !this._rafID) {
          this._scroll(Math.abs(containerHeight - targetRectRelativeToContainer.bottom)); // ensure a positive value as argument
        }
      }
    }



    if (!this._rafID) {
      this._translate3d(this.__targetNewXPosition, targetNewYPosition, 1, this._target);
    }


    const overItem = this._itemFromCoords(event.detail, this.__targetNewXPosition, targetNewYPosition);
    if (overItem && overItem !== this._target) {
      const overItemIndex = this.items.indexOf(overItem);
      const targetIndex = this.items.indexOf(this._target);
      this._moveItemArray(this.items, targetIndex, overItemIndex);
      for(let i = 0; i < this.items.length; i++) {
        if (this.items[i] !== this._target) {
          const rect = this._rects[i];
          requestAnimationFrame(_ => {
            this._translate3d(rect.left, rect.top, 1, this.items[i]);
          });
        }
      }
    }
  }

  _scroll(y) {
    let num;
    let pixelsLeftToScroll = Math.abs(y);
    let pixelsToScrollNow = this.scrollingSpeed;

    if (y < 0) {
      num = -pixelsToScrollNow;
      this._currentScrollDirection = -1; // up
    } else if (y > 0) {
      num = pixelsToScrollNow;
      this._currentScrollDirection = 1; // down
    }

    const containerRect = this.getBoundingClientRect();
    const targetRect = this._target.getBoundingClientRect();

    // updates the target's position to the screens top or bottom limit while scrolling
    // const targetNewYPosition = (targetRect.top - parseFloat(this._computedStyle.borderTopWidth) - parseFloat(this._computedStyle.paddingTop)) - containerRect.top + num;
    const targetNewYPosition = (targetRect.top - parseFloat(this._computedStyle.borderTopWidth) - parseFloat(this._computedStyle.paddingTop)) - containerRect.top + num;

    this._translate3d(this.__targetNewXPosition, targetNewYPosition, 1, this._target);
    window.scrollBy(0, num);
    pixelsLeftToScroll -= pixelsToScrollNow;

    if (pixelsLeftToScroll > 0) {
      this._rafID = requestAnimationFrame(() => {
        this._scroll(this._currentScrollDirection * pixelsLeftToScroll);
      });
    } else {
      this._rafID = 0;
    }
  }

  _cancelRunningScroll() {
    if (this._rafID) {
      cancelAnimationFrame(this._rafID);
      this._rafID = 0;
    }
  }

  _dragDirectionPurposelyChanged(newDirection) {
    // if the last X elements in the direction buffer are the same, than yes, direction has changed.
    const lastElementsQty = 10; // since the track events are highly sensetive, after some testing this number looks good
    const lastElements = this._directionBuffer.slice(-lastElementsQty);

    for(let i=0; i<lastElementsQty; i++) {
      if (lastElements[i] !== newDirection) {
        return false;
      }
    }
    this._directionBuffer = []; // reset it, we dont need the old values if the direction has changed
    return true;
  }

  // The track really ends
  _trackEnd(event) {
    if (!this.dragging) {
      return;
    }
    const rect = this._rects[this.items.indexOf(this._target)];
    this._target.classList.remove('item--pressed');
    this._setDragging(false);
    this._cancelRunningScroll();
    this._translate3d(rect.left, rect.top, 1, this._target);
    this._animatingElementsToNaturalPosition = true;
  }

  _onTransitionEnd() {
    if (this.dragging || !this._target) {
      return;
    }
    const fragment = document.createDocumentFragment();
    this.items.forEach(item => {
      item.style.transform = '';
      item.style.width = item.__originalWidth;
      item.style.height = item.__originalHeight;
      item.classList.remove('item--transform');
      fragment.appendChild(item);
    });
    if (this.children[0]) {
      this.insertBefore(fragment, this.children[0]);
    } else {
      this.appendChild(fragment);
    }
    this.style.height = '';
    this._target.classList.remove('item--dragged');
    this._rects = null;
    this._targetRect = null;
    this._updateItems();
    this.dispatchEvent(new CustomEvent('sort-finish', {
      composed: true,
      detail: {
        target: this._target
      }
    }));
    this._target = null;
    this._animatingElementsToNaturalPosition = false;
  }

  _onDragStart(event) {
    event.preventDefault();
  }

  _onContextMenu(event) {
    if (this.dragging) {
      event.preventDefault();
      this._trackEnd();
    }
  }

  _onTouchMove(event) {
    if (!this.disabled) {
        event.preventDefault();
    }
  }

  _updateItems() {
    if (this.dragging) {
      return;
    }
    const items = this.shadowRoot.querySelector('slot').assignedNodes().filter(node => {
      if ((node.nodeType === Node.ELEMENT_NODE) &&
          (!this.sortable || node.matches(this.sortable))) {
        return true;
      }
    });
    this._setItems(items);
  }

  _itemFromCoords(c, x, y) {
    if (!this._rects) {return;}
    let match = null;
    const updatedTargetRect = Object.assign({}, this._targetRect, {top: y, left: x});

    // The dragging target has to hover/overlap a certain percentage of its area over a sibling in order to be considered a match.
    // This removes a flickering behavior while dragging the elements and gives a better prediction on what sibling the target is
    // actually moving into.
    const areaPercentage = 0.5;

    this._rects.forEach((rect, i) =>  {
      if (this.items[i] !== this._targetRect && this._elementBeingOverlaped(rect, updatedTargetRect, areaPercentage)) {
        match = this.items[i];
      }
    });
    return match;
  }


  _elementBeingOverlaped(beneathElRect, topElRect, minPercentageAreaOfTopEl) {
    const diffLeft = Math.abs(beneathElRect.left - topElRect.left);
    const diffTop = Math.abs(beneathElRect.top - topElRect.top);

    if (diffLeft > beneathElRect.width || diffTop > beneathElRect.height) {
      return false;
    }

    const unionBoxArea = (beneathElRect.width - diffLeft) * (beneathElRect.height - diffTop);

    return unionBoxArea >= minPercentageAreaOfTopEl * topElRect.width * topElRect.height;
  }

  _itemFromEvent(event) {
    const path = event.composedPath();
    for (var i = 0; i < path.length; i++) {
      if (this.items.indexOf(path[i]) > -1) {
        return path[i];
      }
    }
  }

  _getItemsRects() {
    return this.items.map(item => {
      // its pratically HTMLElement.getBoundingClientRect(), but instead of the viewport, its properties are relative to the positioned container.
      return {
        left: item.offsetLeft,
        top: item.offsetTop,
        right: item.offsetLeft + item.offsetWidth,
        bottom: item.offsetTop + item.offsetHeight,
        width: item.offsetWidth,
        height: item.offsetHeight
      };
    })
  }

  _observeItems() {
    if (!this._observer) {
      this._observer = new MutationObserver(_ => {
        this._updateItems();
      });
      this._observer.observe(this, {childList: true});
    }
  }

  _unobserveItems() {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
  }

  /**
   * Move an array item from one position to another.     
   * Source: http://stackoverflow.com/questions/5306680/move-an-array-element-from-one-array-position-to-another
   */
  _moveItemArray(array, oldIndex, newIndex) {
    if (newIndex >= array.length) {
      var k = newIndex - array.length;
      while ((k--) + 1) {
      array.push(undefined);
      }
    }
    array.splice(newIndex, 0, array.splice(oldIndex, 1)[0]);
    return array;
  }

  _translate3d(x, y, z, el) {
    el.style.transform = `translate3d(${x}px, ${y}px, ${z}px)`;
  }
}

customElements.define(SortableList.is, SortableList);
