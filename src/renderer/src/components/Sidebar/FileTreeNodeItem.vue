<script lang="ts">
// WS-05: FileTreeNodeItem - recursive tree node for the file tree.
// Renders a single file/directory entry and its children (if expanded).
// Self-referencing recursive component via defineComponent.

import { defineComponent, h, type PropType } from 'vue'
import { NIcon, NSpin } from 'naive-ui'
import { FolderOutlined, FolderOpenOutlined, InsertDriveFileOutlined } from '@vicons/material'
import type { FileTreeNode } from '@shared/types'

const FileTreeNodeItem = defineComponent({
  name: 'FileTreeNodeItem',
  props: {
    node: {
      type: Object as PropType<FileTreeNode>,
      required: true,
    },
    depth: {
      type: Number,
      required: true,
    },
    isExpanded: {
      type: Function as PropType<(path: string) => boolean>,
      required: true,
    },
    onToggle: {
      type: Function as PropType<(node: FileTreeNode) => void>,
      required: true,
    },
    onContextMenu: {
      type: Function as PropType<(node: FileTreeNode, event: MouseEvent) => void>,
      required: false,
      default: undefined,
    },
  },
  setup(props) {
    return () => {
      const indent = props.depth * 16 + 8
      const expanded = props.node.isDirectory
        ? props.isExpanded(props.node.relativePath)
        : false

      const icon = props.node.isDirectory
        ? expanded
          ? h(NIcon, { size: 16 }, () => h(FolderOpenOutlined))
          : h(NIcon, { size: 16 }, () => h(FolderOutlined))
        : h(NIcon, { size: 16 }, () => h(InsertDriveFileOutlined))

      const label = h('span', { class: 'tree-node__label' }, props.node.name)

      const header = h(
        'div',
        {
          class: ['tree-node', { 'tree-node--dir': props.node.isDirectory }],
          style: { paddingLeft: `${indent}px` },
          onClick: () => props.onToggle(props.node),
          onContextmenu: (e: MouseEvent) => {
            if (props.onContextMenu) {
              e.preventDefault()
              props.onContextMenu(props.node, e)
            }
          },
        },
        [icon, label],
      )

      const children: ReturnType<typeof h>[] = [header]

      if (props.node.isDirectory && expanded && props.node.children) {
        for (const child of props.node.children) {
          children.push(
            h(FileTreeNodeItem, {
              key: child.id,
              node: child,
              depth: props.depth + 1,
              isExpanded: props.isExpanded,
              onToggle: props.onToggle,
              onContextMenu: props.onContextMenu,
            }),
          )
        }
      }

      if (props.node.isDirectory && expanded && props.node.children === null) {
        children.push(
          h(
            'div',
            { class: 'tree-node__loading', style: { paddingLeft: `${indent + 24}px` } },
            [h(NSpin, { size: 'small' })],
          ),
        )
      }

      return h('div', { class: 'tree-node-wrapper' }, children)
    }
  },
})

export default FileTreeNodeItem
</script>
