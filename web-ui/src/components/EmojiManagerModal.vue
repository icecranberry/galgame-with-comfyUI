<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="show" class="modal-overlay">
        <div class="modal-panel modal-wide emoji-manager-modal">
          <div class="modal-header">
            <h3>表情包管理</h3>
            <span
              class="modal-close"
              role="button"
              tabindex="0"
              aria-label="关闭"
              title="关闭"
              @click="close"
              @keydown.enter.prevent="close"
              @keydown.space.prevent="close"
            >✕</span>
          </div>

          <div class="emoji-body">
            <!-- 生成 prompt 时的全局扫描遮罩 -->
            <div v-if="starting" class="emoji-gen-overlay">
              <div class="emoji-gen-line"></div>
              <div class="emoji-gen-glow"></div>
              <div class="emoji-gen-content">
                <div class="emoji-gen-label">表情脚本生成中</div>
                <div class="emoji-gen-phrase">
                  <Transition name="emoji-gen-phrase" mode="out-in">
                    <p :key="scanTipIndex">{{ scanTips[scanTipIndex] }}</p>
                  </Transition>
                </div>
              </div>
            </div>
            <!-- 左侧：角色头像列表（单选） -->
            <div class="emoji-left">
             <div class="emoji-char-picker">
              <div v-if="!isMobile" class="emoji-left-title">角色列表</div>
                <div v-if="isMobile" class="emoji-char-trigger" role="button" tabindex="0" aria-haspopup="listbox" :aria-expanded="charPickerOpen" @click="charPickerOpen = !charPickerOpen" @keydown.enter.prevent="charPickerOpen = !charPickerOpen" @keydown.space.prevent="charPickerOpen = !charPickerOpen" @keydown.escape.prevent="charPickerOpen = false">
                  <div class="emoji-char-avatar" :style="characterAvatarStyle(selectedCharacter)">{{ selectedCharacter?.avatar_path ? '' : selectedCharacterName.charAt(0) }}</div>
                  <span class="emoji-char-trigger-meta">
                    <span class="emoji-char-trigger-name">{{ selectedCharacterName }}</span>
                    <span class="emoji-char-trigger-count">{{ selectedCountText }}</span>
                  </span>
                  <svg class="emoji-char-trigger-chevron" :class="{ open: charPickerOpen }" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </div>
                <Transition name="emoji-picker-fade">
                <div v-show="!isMobile || charPickerOpen" class="emoji-char-layer" :class="{ open: isMobile && charPickerOpen }">
                  <div v-if="isMobile" class="emoji-picker-scrim" tabindex="-1" aria-label="关闭角色列表" @click="charPickerOpen = false" @keydown.escape.prevent="charPickerOpen = false"></div>
                  <div class="emoji-char-dropdown" role="listbox" aria-label="选择角色" @keydown.escape.prevent="charPickerOpen = false">
                    <div v-if="isMobile" class="emoji-dropdown-head">选择角色</div>
                    <div class="emoji-char-list">
                <div
                  v-for="c in characters"
                  :key="c.id"
                  class="emoji-char-item"
                  :class="{ active: selectedCharId === c.id }"
                  @click="selectCharacter(c.id)"
                >
                  <div
                    class="emoji-char-avatar"
                    :style="characterAvatarStyle(c)"
                  >{{ c.avatar_path ? '' : (c.display_name || c.name || '?').charAt(0) }}</div>
                   <div class="emoji-char-meta">
                     <div class="emoji-char-name">{{ c.display_name || c.name }}</div>
                     <div class="emoji-char-count" :class="{ full: isCharFull(c.id), generating: charGenerating(c.id) }">
                       <span v-if="charGenerating(c.id)" class="emoji-gen-badge">
                         <span class="emoji-spinner emoji-count-spinner"></span>
                         <span>生成中</span>
                       </span>
                       <span class="emoji-count-num">{{ doneCount(c.id) }}</span>
                       <span class="emoji-count-total">/{{ emojiKeys.length }}</span>
                       <span v-if="isCharFull(c.id) && !charGenerating(c.id)" class="emoji-full-icon" title="全部表情包已生成">
                         <svg viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true">
                           <path d="M1017.1264 367.6928L861.4784 122.3424c-13.7216-21.632-42.2144-27.968-63.3216-14.2464L21.4912 599.296C-0.1408 613.0304-6.4768 641.536 7.2448 662.6304l155.648 245.3504c13.7216 21.1072 42.2144 27.4304 63.3088 14.2464L1002.88 431.0016c21.0944-13.184 27.4304-41.6768 14.2464-63.3088zM985.984 404.608L209.3184 895.8464a14.5664 14.5664 0 0 1-20.0448-4.7488L33.6256 646.272a14.5664 14.5664 0 0 1 4.736-20.0448l776.1536-491.7504a14.5664 14.5664 0 0 1 20.0448 4.736l155.648 245.3632a13.9904 13.9904 0 0 1-4.224 20.0448z m-669.5552-155.648l12.672 31.1296 16.8832-29.0176 33.2416-2.6368-22.6944-24.8064 7.9104-32.704-30.592 13.7088-28.4928-17.408 3.6864 33.2416-25.3184 21.632 32.704 6.8608z m197.8624-91.8144L498.4576 127.616l-13.7088 30.592-33.2416 6.3488 24.7936 22.144-4.224 33.2544 29.0304-16.896 30.08 14.2592-6.8736-32.7168 23.2192-24.2688-33.2416-3.1744zM815.5648 650.496l-26.368-20.5824v33.2416l-27.9808 18.9952 32.192 10.56 9.4976 32.1792 20.0448-26.9056 33.7664 1.0496-19.52-27.4304 11.6096-31.1296-33.2416 10.0224z m-108.16 132.9664l-12.672-31.1296-16.8704 29.0176-33.2416 2.6368 22.144 24.7936-7.8976 32.7168 30.592-13.184 28.4928 17.92-3.1616-33.2288 25.3312-21.632-32.7168-7.9104z m-198.4 90.752l15.8336 29.5424 13.7216-30.592 33.2416-5.8112-24.7936-22.6944 4.736-33.2416-29.0048 16.3584-30.08-14.7712 6.8608 32.7168-23.2192 24.2688 32.7168 4.224zM211.4432 378.752L237.824 399.36l0.5376-33.2416 27.9552-18.4704-31.6544-10.5472-8.96-32.192-20.0576 26.9184-33.7664-2.112 19.52 27.4304-11.6096 31.6544c-0.5248 0 31.6544-10.0224 31.6544-10.0224zM93.7728 523.3408c-3.6992-141.9392 65.4208-281.7536 193.6384-363.008 128.2176-81.2544 284.3904-83.3664 411.5456-20.0576l30.6048-19.52c-37.4656-21.1072-78.08-36.4032-120.2944-45.9008a449.408 449.408 0 0 0-172.0064-4.7488c-59.0976 10.0224-115.0208 31.1296-166.208 63.8464-51.712 32.1792-94.976 73.856-129.2672 122.9312a442.2656 442.2656 0 0 0-69.12 157.2352 456.4096 456.4096 0 0 0-10.0224 128.2176c0 0.512 31.1296-18.9952 31.1296-18.9952z m833.6512-21.632c3.6992 141.9264-65.4208 281.7536-193.6384 363.008-128.2176 81.2544-284.3904 83.3536-411.5456 20.0448l-30.6048 19.52c37.4656 21.1072 78.08 36.4032 120.2944 45.9008a449.408 449.408 0 0 0 172.0064 4.7488 452.5952 452.5952 0 0 0 166.208-63.3088 446.9504 446.9504 0 0 0 128.7424-122.944 442.2656 442.2656 0 0 0 69.12-157.2224c9.4976-42.752 12.6592-85.4784 10.0224-128.2176l-30.6048 18.4704zM379.7504 306.4832a245.1072 245.1072 0 0 1 115.0208-37.4656l47.488-30.08a272.8576 272.8576 0 0 0-179.392 41.1648c-53.824 34.304-93.3888 84.9408-113.4464 144.5632l47.488-30.08c19.52-34.816 46.9632-65.408 82.8416-88.1024z m261.696 412.0704a245.1072 245.1072 0 0 1-115.0208 37.4656l-47.488 30.08c62.7968 7.3856 125.056-6.8608 179.392-41.1648 53.824-34.2912 93.3888-84.9408 113.4464-144.5632l-47.488 30.08a240.3072 240.3072 0 0 1-82.8416 88.1024z" />
                           <path d="M287.936 634.2144l-33.5488-53.6832-99.456 62.1312c-2.7136 1.7024-4.9792 3.8144-6.784 6.336l-11.6224-6.1696c4.4544-1.792 8.256-3.6736 11.4048-5.632l98.1632-61.3376c-0.9472-10.752-1.408-16.6016-1.3824-17.5104 0.0256-0.9088 0.6144-1.728 1.7536-2.432 1.152-0.7296 3.6864-1.1136 7.6288-1.1904 3.9296-0.064 10.0096 0.0128 18.2272 0.256 8.2176 0.256 13.1072 0.512 14.6944 0.8192 1.5872 0.3072 2.688 0.96 3.328 1.9584 1.2416 2.0096 0.128 5.4912-3.3408 10.4448l24.2944 38.8736c3.1232 5.0176 5.7984 9.1264 8 12.3264l5.7984 8.32c0.896 1.4336 0.896 3.1744-0.0128 5.248-0.9088 2.048-3.0848 4.6976-6.528 7.9488-3.456 3.2512-6.912 5.9648-10.432 8.1664-3.5072 2.176-5.8752 3.264-7.0912 3.2256-1.216-0.0384-2.2272-0.6912-3.0336-1.984l-5.632-9.024-83.328 52.0704 40.256 64.4352c2.7776 4.4416 6.0416 7.1296 9.8176 8.064 3.7632 0.9216 9.4208-0.128 16.9856-3.1616 7.552-3.0336 17.3568-8.3072 29.3888-15.8208 30.4896-19.0592 48.9344-32.0768 55.3344-39.0528 6.3872-6.976 9.5744-14.464 9.5744-22.4128 0-7.9744-2.6368-19.8528-7.936-35.6608-0.7296-2.1248-0.6656-3.456 0.192-3.9936 0.8576-0.5376 2.1376 0.7936 3.84 4.0064 1.7152 3.2128 3.5968 6.4768 5.6576 9.7664 4.8256 7.7312 9.2288 12.6976 13.184 14.8992 3.968 2.2016 8.96 3.328 14.9504 3.3536 3.712-0.128 6.6048 1.4976 8.704 4.864 2.112 3.3664 2.0096 8.8576-0.3072 16.4736-2.304 7.616-8.8064 15.6928-19.4816 24.256-10.6752 8.576-27.2512 19.8784-49.728 33.92-28.7872 17.984-49.792 29.7728-63.0272 35.3536-13.2352 5.5808-23.36 7.2192-30.3616 4.928-7.0016-2.2912-13.9136-8.8704-20.7104-19.7504l-46.848-74.9568a431.6672 431.6672 0 0 0-15.6672-23.6544 216.832 216.832 0 0 1 21.7088-9.2416c7.1552-2.56 11.392-3.8272 12.7232-3.7632 1.3312 0.064 2.2656 0.512 2.816 1.3824 1.152 1.856 0.3328 4.3648-2.4832 7.5136l6.976 11.1744 83.328-52.0832zM441.3696 423.0656c8.5888-5.3632 16.0512-8.0768 22.3744-8.1536 6.3232-0.0768 11.0976 2.4704 14.3232 7.6288 2.3296 3.712 2.9184 8.1792 1.792 13.3632-1.152 5.1968-3.1872 8.704-6.1184 10.5344-2.944 1.8432-5.632 2.8672-8.064 3.1104a12.7872 12.7872 0 0 1-6.5792-0.9728 9.7024 9.7024 0 0 1-4.3904-3.6736l-2.4704-4.4288c-4.288-6.8736-8.704-9.792-13.2352-8.7552-3.4304 0.5504-5.504 0.256-6.2208-0.896-0.7168-1.1392 2.1376-3.7248 8.576-7.7568z m-17.1136 55.7824l86.5664-54.08a486.7968 486.7968 0 0 0-1.28-18.7648c-0.2944-2.7008 0.3456-4.544 1.92-5.5296 1.5744-0.9856 5.824-1.0496 12.7232-0.192l18.9824 2.176c5.4528 0.768 8.6144 1.8432 9.472 3.2 0.8448 1.3568-0.2432 2.9824-3.2384 4.864l-59.9296 37.44a7.8848 7.8848 0 0 1-1.28 5.5808l9.1136 14.6048 20.4032-12.7488c-0.3584-10.1248-0.4736-16.128-0.3456-17.9968a5.0816 5.0816 0 0 1 2.4448-4.224c1.5104-0.9344 7.808-0.896 18.9056 0.1408 11.0976 1.024 17.152 2.368 18.176 4.0192 1.024 1.6512 0.0512 3.4048-2.9568 5.2864l-52.1984 32.6144 11.5456 18.4704 20.8384-13.0176c-0.2688-3.6224-0.384-7.3856-0.3328-11.2896 0.0384-3.9168 0.192-6.2976 0.448-7.1552a3.712 3.712 0 0 1 1.6768-2.0992c1.8688-1.152 8.2816-1.3312 19.2384-0.512 10.9568 0.8064 16.9088 1.9712 17.856 3.4688 0.9344 1.5104-0.1024 3.2-3.1104 5.0816l-52.1856 32.6144 11.136 17.8176 33.728-21.0688a229.8368 229.8368 0 0 1-0.3328-16.064c0.0896-4.1472 0.64-6.528 1.6512-7.1552 1.5744-0.9856 5.6064-1.216 12.1088-0.6912l18.496 1.8816c5.7344 0.5888 9.0368 1.5616 9.8816 2.9184 0.8576 1.3696-0.1536 2.944-3.0208 4.736l-82.688 51.6608c8.96-3.2 14.208-4.736 15.7696-4.6336 1.5744 0.128 2.624 0.6144 3.1616 1.472 1.152 1.856 0.192 3.968-2.9312 6.3104l4.9664 7.936 53.2736-33.28c-0.1664-2.4832-0.1536-6.6816 0.0512-12.5696 0.192-5.9008 0.4864-9.2672 0.8576-10.0992a3.9296 3.9296 0 0 1 1.4208-1.792c1.28-0.7936 7.6416-0.4352 19.0464 1.1008 11.4176 1.536 17.6256 3.1104 18.6624 4.7616 1.024 1.6512 0.1152 3.3664-2.752 5.1584l-79.4752 49.664c12.1984 1.3312 21.9904 1.728 29.4144 1.1776 7.424-0.5632 15.3088-2.5088 23.68-5.8368 8.3712-3.3408 20.736-9.1264 37.0816-17.3568 2.624-1.2288 4.0832-1.6 4.3904-1.1008 0.32 0.512-0.4736 2.176-2.3552 5.056-1.8944 2.88-3.2384 6.848-4.0448 11.9424a39.04 39.04 0 0 0 0.6656 15.3984c0.64 2.5984 0.0896 4.4288-1.6384 5.504-1.7152 1.0752-9.8304 2.816-24.3584 5.2224-14.528 2.4064-26.6752 2.4832-36.4416 0.2304-9.7792-2.2656-20.736-7.552-32.9088-15.872l20.5312 32.8576c3.4944 5.5808 5.9776 9.408 7.4624 11.4688l3.84 5.6576a5.4272 5.4272 0 0 1 0.384 5.1456c-0.7424 1.856-2.6496 4.5312-5.7344 8.064a45.824 45.824 0 0 1-10.2016 8.7552c-3.712 2.3296-6.2464 2.4192-7.5904 0.256l-4.9408-8.8448c-2.2784-3.968-5.12-8.6528-8.512-14.1056l-15.4368-24.704a153.0112 153.0112 0 0 1-11.9168 33.7408c-5.1584 10.3936-13.2608 22.912-24.2944 37.5808-11.0464 14.6688-17.6512 22.6688-19.7888 24.0128-0.4352 0.256-0.6912 0.3328-0.7808 0.192-0.2688-0.4352 0.6144-2.688 2.6624-6.7456 9.4208-18.048 15.9872-33.024 19.6608-44.992a175.488 175.488 0 0 0 7.04-38.8992l-53.888 33.6896c-2.8672 1.792-4.9536 4.1856-6.272 7.1936l-11.8784-6.6048c3.6992-1.7152 7.424-3.7376 11.136-6.0672l78.3872-48.9856a504.6784 504.6784 0 0 0-11.0848-17.2672l-28.992 18.1248c2.4704 3.6352 1.7536 7.6672-2.1504 12.096-3.904 4.4288-7.4624 7.6416-10.688 9.664-3.2128 2.0096-5.5424 1.8688-6.976-0.4224l-14.656-24.8832-26.7008-42.752c-2.3552 9.6384-5.7728 19.6864-10.2784 30.1696-4.4928 10.4832-7.2448 16.0256-8.256 16.6528-0.1408 0.0896-0.256 0.064-0.3456-0.0768-0.3584-0.576-0.1024-3.0208 0.768-7.36 6.08-31.0656 3.6608-64.0896-7.2576-99.072 20.5312-6.656 32.3712-10.1888 35.52-10.56 3.1488-0.384 5.1456 0.128 6.0032 1.4848 0.8448 1.3568 0.4352 2.7648-1.2544 4.2112a13.696 13.696 0 0 0-3.8656 6.0032c-0.896 2.5472-1.6768 6.2208-2.3552 11.0208-0.6912 4.8128-1.152 7.808-1.4336 8.96 1.6896 0.1408 3.072 0.4608 4.1856 0.96z m37.0816-13.312l-32.8576 20.544a11.0976 11.0976 0 0 1-1.1904 1.92l10.752 17.1904 34.56-21.6064-11.264-18.048z m15.7056 25.1392l-34.5856 21.6064 11.5456 18.4704 34.5728-21.6064-11.5328-18.4704z m27.1104 43.392l-11.136-17.8432-34.5856 21.6192 11.136 17.8176 34.5856-21.6064zM676.16 274.2656c21.632-13.5168 35.84-14.8224 42.624-3.9424 2.88 4.5824 3.9424 9.3952 3.2 14.4256-0.7296 5.0432-3.328 8.9472-7.7568 11.7248a18.432 18.432 0 0 1-8.0896 2.816c-2.816 0.256-5.0944-0.1024-6.8224-1.1136-1.728-1.024-3.4816-2.944-5.2736-5.8112-2.24-3.584-5.9136-6.528-11.008-8.7936-5.12-2.2912-9.2672-2.88-12.4672-1.7792s-4.928 1.4336-5.1968 1.0112c-0.5376-0.8576 3.072-3.712 10.7904-8.5376z m-4.7488 61.2096l-33.728 21.0688c-2.8672 1.792-4.9408 4.1856-6.2592 7.1936l-11.8912-6.6048c3.712-1.7152 7.424-3.7376 11.136-6.0672l137.472-85.888-1.152-22.8736c-0.0768-2.3552 0.384-3.84 1.3952-4.4672 0.9984-0.6144 5.7856-0.6784 14.3744-0.1664 8.576 0.512 15.8464 1.2928 21.7856 2.368 5.9392 1.0624 9.2928 2.2016 10.048 3.4176 0.768 1.216-0.1408 2.6368-2.7264 4.2368l-35.2128 22.016c8.7424-1.28 13.6192-1.152 14.592 0.4352 0.8064 1.28-0.3968 2.944-3.6224 4.9536a12.48 12.48 0 0 0-5.9008 8.4608 195.584 195.584 0 0 1-15.8976 45.7728 269.6064 269.6064 0 0 0 76.5056-32.8832l9.536-6.2464c1.28-0.8064 2.112-0.9216 2.4704-0.3456 0.3584 0.5632-0.128 1.8688-1.4464 3.8912-2.7904 4.1344-4.48 9.7152-5.0688 16.7424-0.576 7.04 0.2048 13.0688 2.3552 18.0992 0.7808 1.8944 0.256 3.4304-1.6128 4.5952-3.1488 1.9584-15.2192 5.5168-36.1856 10.6624-20.992 5.1456-40.8448 8-59.6096 8.576-7.7568 12.416-17.536 25.2928-29.312 38.6176 14.4256-6.2208 22.3616-9.536 23.808-9.9328 1.4336-0.4096 2.5344 0 3.2896 1.216 0.768 1.216 0.6656 2.7264-0.3072 4.5184a7.424 7.424 0 0 0-0.7296 5.5296c0.4864 1.8944 1.92 5.376 4.3008 10.4576 2.3808 5.0944 4.736 11.8784 7.0528 20.3776 2.3296 8.512 3.712 15.8976 4.16 22.1952a61.6448 61.6448 0 0 1-2.176 20.1728 89.792 89.792 0 0 1-9.1392 21.6832c-4.1984 7.296-9.792 14.848-16.7936 22.592-7.0016 7.7568-11.7888 12.4416-14.3616 14.0544-1.0112 0.6272-1.7024 0.6144-2.112-0.0256-0.3968-0.64-0.0896-1.5872 0.9216-2.816 8.3584-10.2016 14.0032-20.0448 16.9344-29.5424a68.5312 68.5312 0 0 0 2.4448-29.312c-1.2928-10.0352-3.5328-18.7904-6.7072-26.2656-3.1744-7.4624-9.664-19.2-19.456-35.1744a373.9264 373.9264 0 0 1-29.1456 27.1744c-9.6256 8.0128-15.3472 12.5696-17.1264 13.696-1.792 1.1136-2.7392 1.6-2.816 1.4592-0.2816-0.4352 0.9728-2.112 3.7248-5.0176 29.056-30.912 49.664-59.6096 61.7856-86.0928a155.9552 155.9552 0 0 1-59.5968-16.512z m75.8144-47.3856l-70.656 44.16c18.688 4.4416 39.0912 5.2352 61.1968 2.368 5.2864-15.4496 8.4352-30.9504 9.4592-46.528z m32.0384 71.36c13.184-7.2448 22.3616-11.776 27.4944-13.5936 5.1328-1.8176 8.128-2.048 8.9856-0.6784 0.8448 1.3568 0.192 3.8144-1.9712 7.36l32.3328 51.7504c4.3904 7.0144 7.5008 11.84 9.344 14.464l5.184 7.8208c0.7168 1.152 0.704 2.496-0.0128 4.0448-0.7296 1.536-3.1104 4.1856-7.168 7.8976-4.032 3.7248-7.488 6.4896-10.3552 8.2688-2.8672 1.792-4.736 2.7136-5.5936 2.752-0.8704 0.0512-1.7536-0.64-2.6496-2.0736l-43.2128-69.1584c-4.48-7.168-8.6016-13.44-12.3776-18.8544z" />
                         </svg>
                       </span>
                     </div>
                     <div class="emoji-char-progress" :class="{ full: isCharFull(c.id), generating: charGenerating(c.id) }">
                       <i :style="{ width: charPercent(c.id) + '%' }"></i>
                     </div>
                  </div>
                </div>
                    </div>
                  </div>
                </div>
                </Transition>
              </div>
              <div class="emoji-batch-row">
                <div
                  class="emoji-batch-btn"
                  role="button"
                  tabindex="0"
                  :class="{ paused: batchRunning && batchPaused, 'is-disabled': characters.length === 0 || (batchRunning && !batchPaused) || (!batchRunning && generating) }"
                  :aria-disabled="characters.length === 0 || (batchRunning && !batchPaused) || (!batchRunning && generating)"
                  @click="onBatchTrigger"
                  @keydown.enter.prevent="onBatchTrigger"
                  @keydown.space.prevent="onBatchTrigger"
                >
                  <span v-if="batchRunning && !batchPaused" class="emoji-spinner emoji-batch-spinner"></span>
                  {{ batchRunning && batchPaused ? '继续生成' : (batchRunning ? `生成中 ${batchIndex + 1}/${characters.length}` : '全部生成') }}
                </div>
                <div
                  v-if="batchRunning && !batchPaused"
                  class="emoji-pause-btn"
                  role="button"
                  tabindex="0"
                  title="暂停全部生成"
                  @click="pauseBatch"
                  @keydown.enter.prevent="pauseBatch"
                  @keydown.space.prevent="pauseBatch"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="6" y="4" width="4" height="16" rx="1.2" />
                    <rect x="14" y="4" width="4" height="16" rx="1.2" />
                  </svg>
                </div>
              </div>
            </div>

            <!-- 右侧：生成控制 + 表情包网格 -->
            <div class="emoji-right">
              <div class="emoji-toolbar-row">
                <div class="emoji-gear" role="button" tabindex="0" title="高级设置" @click="showAdvancedSettings = true" @keydown.enter.prevent="showAdvancedSettings = true" @keydown.space.prevent="showAdvancedSettings = true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </div>
                <div
                  class="emoji-mode-badge"
                  role="button"
                  tabindex="0"
                  :class="[styleMode, { 'is-disabled': styleModeSaving }]"
                  :aria-disabled="styleModeSaving"
                  @click="toggleStyleMode"
                  @keydown.enter.prevent="toggleStyleMode"
                  @keydown.space.prevent="toggleStyleMode"
                  title="点击切换表情包风格"
                >{{ STYLE_MODE_LABELS[styleMode] || '半身LINE' }}</div>
                <linshe-input
                  v-model="style"
                  class="emoji-style-input"
                  type="text"
                  placeholder="自定义表情包额外需求（可选，留空则不注入）"
                />
                <linshe-button
                  v-if="selectedCharHasPrompts"
                  variant="primary"
                  :disabled="generating || selectedCharId === null"
                  title="不重新提炼提示词，直接用现有提示词重新生成全部表情图片"
                  @click="regenerateAllImages"
                >
                  {{ generating ? '生成中...' : '重新生成' }}
                </linshe-button>
                <linshe-button
                  v-if="!selectedCharHasPrompts"
                  variant="primary"
                  :disabled="generating || selectedCharId === null"
                  @click="generateAll"
                >
                  {{ generating ? '生成中...' : '生成表情包' }}
                </linshe-button>
                <linshe-button
                  v-else
                  variant="secondary"
                  class="emoji-redo-btn"
                  :disabled="generating || selectedCharId === null"
                  title="重新提炼表情提示词，并用新提示词生成全部表情图片"
                  @click="generateAll"
                >完全重做</linshe-button>
              </div>

              <div v-if="batchRunning" class="emoji-progress-strip" :class="{ paused: batchPaused }">
                <span v-if="!batchPaused" class="emoji-spinner"></span>
                <span v-else class="emoji-paused-mark"></span>
                <span class="emoji-progress-label">{{ batchProgressText }}</span>
              </div>
              <div v-if="imageProgressVisible" class="emoji-progress-strip">
                <span class="emoji-spinner"></span>
                <span class="emoji-progress-label">{{ imageProgressText }}</span>
              </div>
              <div v-if="selectedCharId === null" class="emoji-empty">
                请在左侧选择要管理表情包的角色
              </div>

              <div v-if="selectedCharId !== null && emojiKeys.length > 0" class="emoji-char-section">
                <div class="emoji-char-title">{{ charName(selectedCharId) }}</div>
                <TransitionGroup name="emoji-reveal" tag="div" class="emoji-grid">
                  <div
                    v-for="key in emojiKeys"
                    :key="key"
                    class="emoji-card"
                    :class="{ done: isDone(selectedCharId, key), empty: !rowFor(selectedCharId, key), generating: isGenerating(selectedCharId, key), failed: isFailed(selectedCharId, key) }"
                  >
                    <div class="emoji-card-head">
                      <span class="emoji-key">{{ key }}</span>
                      <span class="emoji-status">
                        <span v-if="isGenerating(selectedCharId, key)">...</span>
                        <span v-else-if="isFailed(selectedCharId, key)">!</span>
                      </span>
                    </div>

                    <div
                      v-if="isDone(selectedCharId, key)"
                      class="emoji-card-delete"
                      role="button"
                      tabindex="0"
                      :title="deletingKey === selectedCharId + ':' + key ? '删除中...' : '删除'"
                      :class="{ 'is-disabled': busyKey === selectedCharId + ':' + key || uploadingKey === selectedCharId + ':' + key || deletingKey === selectedCharId + ':' + key }"
                      :aria-disabled="busyKey === selectedCharId + ':' + key || uploadingKey === selectedCharId + ':' + key || deletingKey === selectedCharId + ':' + key"
                      @click.stop="removeEmoji(selectedCharId, key)"
                      @keydown.enter.prevent="removeEmoji(selectedCharId, key)"
                      @keydown.space.prevent="removeEmoji(selectedCharId, key)"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                    </div>

                    <template v-if="rowFor(selectedCharId, key)">
                      <div class="emoji-image-wrap">
<img v-if="isDone(selectedCharId, key) && rowImage(selectedCharId, key)" :src="rowImage(selectedCharId, key)" class="emoji-image" loading="lazy" decoding="async" />
                        <div v-else-if="!isCardLoading(selectedCharId, key)" class="emoji-image-placeholder">+</div>
                        <div v-if="isCardLoading(selectedCharId, key)" class="emoji-scan-overlay">
                          <span class="emoji-spinner"></span>
                        </div>
                      </div>
                      <div class="emoji-card-actions">
                        <linshe-button
                          variant="secondary"
                          size="sm"
                          class="btn-sm"
                          :disabled="busyKey === selectedCharId + ':' + key || uploadingKey === selectedCharId + ':' + key || isGenerating(selectedCharId, key)"
                          @click="openUpload(selectedCharId, key)"
                        >上传</linshe-button>
                        <linshe-button
                          variant="secondary"
                          size="sm"
                          class="btn-sm"
                          :disabled="busyKey === selectedCharId + ':' + key || uploadingKey === selectedCharId + ':' + key || isGenerating(selectedCharId, key)"
                          @click="generateOneImage(selectedCharId, key)"
                        >重新生成</linshe-button>
                      </div>
                      <div v-if="rowError(selectedCharId, key)" class="emoji-error">{{ rowError(selectedCharId, key) }}</div>
                    </template>

                    <template v-else>
                      <div class="emoji-empty-slot" @click="openUpload(selectedCharId, key)">
                        <span v-if="isGenerating(selectedCharId, key) || isCardLoading(selectedCharId, key)" class="emoji-spinner"></span>
                        <span v-else class="emoji-empty-plus">+</span>
                      </div>
                      <div v-if="rowError(selectedCharId, key)" class="emoji-error">{{ rowError(selectedCharId, key) }}</div>
                    </template>
                  </div>
                </TransitionGroup>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 高级设置弹窗 -->
    <Transition name="modal-fade">
      <div v-if="showAdvancedSettings" class="modal-overlay advanced-overlay">
        <div class="modal-panel advanced-panel">
          <div class="modal-header">
            <h3>高级设置</h3>
            <span
              class="modal-close"
              role="button"
              tabindex="0"
              aria-label="关闭"
              title="关闭"
              @click="showAdvancedSettings = false"
              @keydown.enter.prevent="showAdvancedSettings = false"
              @keydown.space.prevent="showAdvancedSettings = false"
            >✕</span>
          </div>

          <div class="advanced-body">
            <div class="advanced-content">
            <div class="advanced-section">
              <div class="advanced-label">画师串</div>
              <linshe-input v-model="artist" class="advanced-artist-input" type="text" placeholder="@ebora" />
              <div class="advanced-hint">生成表情包时固定使用该画师串，不再沿用对话画师串。</div>
            </div>

            <div class="advanced-section">
              <div class="advanced-label">表情类别</div>
              <div class="advanced-cat-list">
                <div v-for="(k, i) in categoryDrafts" :key="i" class="advanced-cat-row">
                  <span class="advanced-cat-index">{{ i + 1 }}</span>
                  <linshe-input v-model="categoryDrafts[i]" class="advanced-cat-input" type="text" />
                </div>
                </div>
              <div v-if="categoryError" class="emoji-error">{{ categoryError }}</div>
            </div>

            <div class="advanced-section">
              <div class="advanced-label">表情包风格</div>
              <div class="emoji-style-segmented">
                <div role="button" tabindex="0" :class="['emoji-style-chip', { active: styleMode === 'half_body' }]" @click="styleMode = 'half_body'" @keydown.enter.prevent="styleMode = 'half_body'" @keydown.space.prevent="styleMode = 'half_body'">半身LINE</div>
                <div role="button" tabindex="0" :class="['emoji-style-chip', { active: styleMode === 'half_body_chibi' }]" @click="styleMode = 'half_body_chibi'" @keydown.enter.prevent="styleMode = 'half_body_chibi'" @keydown.space.prevent="styleMode = 'half_body_chibi'">半身Q版</div>
                <div role="button" tabindex="0" :class="['emoji-style-chip', { active: styleMode === 'chibi_head' }]" @click="styleMode = 'chibi_head'" @keydown.enter.prevent="styleMode = 'chibi_head'" @keydown.space.prevent="styleMode = 'chibi_head'">猪鼻大头</div>
              </div>
              <div class="advanced-hint">{{ styleModeHint }}</div>
            </div>

            <div class="advanced-section">
              <div class="advanced-label">表情包起手式Tag</div>
              <linshe-input
                v-model="fixedTagsDraft"
                class="advanced-tags-input"
                type="textarea"
                rows="3"
                placeholder="chibi character, big head, ...（逗号分隔）"
              />
              <div class="advanced-hint">生成 prompt 后由系统硬编码前置到每条表情 prompt 开头（英文，逗号分隔，已存在的 tag 自动去重）。</div>
              <div v-if="fixedTagsError" class="emoji-error">{{ fixedTagsError }}</div>
            </div>
            </div>
          </div>

          <div class="advanced-footer">
            <linshe-button variant="secondary" @click="showAdvancedSettings = false">取消</linshe-button>
            <linshe-button variant="primary" :disabled="categorySaving" @click="saveAdvancedSettings">保存</linshe-button>
          </div>
        </div>
      </div>
    </Transition>
    <!-- 全部生成弹窗 -->
    <Transition name="modal-fade">
      <div v-if="showBatchDialog" class="modal-overlay advanced-overlay">
        <div class="modal-panel batch-panel">
          <div class="modal-header">
            <h3>全部生成</h3>
            <span
              class="modal-close"
              role="button"
              tabindex="0"
              aria-label="关闭"
              title="关闭"
              @click="showBatchDialog = false"
              @keydown.enter.prevent="showBatchDialog = false"
              @keydown.space.prevent="showBatchDialog = false"
            >✕</span>
          </div>

          <div class="advanced-body">
            <div class="advanced-content">
            <div class="advanced-section">
              <div class="advanced-label">自定义整体风格</div>
              <linshe-input
                v-model="batchStyle"
                class="advanced-artist-input"
                type="text"
                placeholder="可选，留空则不注入整体风格"
                @keyup.enter="startBatchGenerate"
              />
              <div class="advanced-hint">将按角色列表顺序，为全部 {{ characters.length }} 个角色逐个生成表情包。</div>
            </div>
            </div>
          </div>

          <div class="advanced-footer">
            <linshe-button variant="secondary" @click="showBatchDialog = false">取消</linshe-button>
            <linshe-button variant="primary" @click="startBatchGenerate">开始生成</linshe-button>
          </div>
        </div>
      </div>
    </Transition>
    <input ref="uploadInputRef" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" hidden @change="onUploadFileChange" />
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, inject } from 'vue'
import * as api from '../api/index.js'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'

const props = defineProps({
  characters: { type: Array, default: () => [] },
})
const emit = defineEmits(['close'])

const toast = inject('toast')
const confirmFn = inject('confirm', null)
const show = ref(true)
const selectedCharId = ref(null)
const isMobile = inject('isMobile', ref(false))
const charPickerOpen = ref(false)
const style = ref('')
const artist = ref('@ebora')
const emojiRows = ref([])
const emojiKeys = ref([])
const starting = ref(false)
const busyKey = ref('')
const pendingUpload = ref(null)
const uploadingKey = ref('')
const deletingKey = ref('')
const uploadInputRef = ref(null)
const showAdvancedSettings = ref(false)
const categoryDrafts = ref([])
const categorySaving = ref(false)
const categoryError = ref('')
const fixedTagsDraft = ref('')
const fixedTagsError = ref('')
const styleMode = ref('half_body')
const styleModeSaving = ref(false)
/** 表情包风格三种：徽章点击按此顺序循环切换 */
const STYLE_MODE_ORDER = ['half_body', 'half_body_chibi', 'chibi_head']
const STYLE_MODE_LABELS = { half_body: '半身LINE', half_body_chibi: '半身Q版', chibi_head: '猪鼻大头' }
const styleModeHint = computed(() => {
  switch (styleMode.value) {
    case 'half_body_chibi':
      return '起手式 tag 将额外追加 chibi, big head, upper body，Q版大头 + 上半身构图，保留角色服装描述。'
    case 'chibi_head':
      return '按 chibi character, big head 风格生成表情包，并禁止模型添加角色服装描述。'
    default:
      return '起手式 tag 将额外追加 half body。'
  }
})
const showBatchDialog = ref(false)
const batchStyle = ref('')
const batchRunning = ref(false)
const batchIndex = ref(0)
const batchPaused = ref(false)
const batchCompleted = ref(0)
// 正在生成 prompt（LLM 阶段）的角色：此阶段行状态还没变 generating，卡片模糊层靠它驱动
const promptPendingCharIds = ref([])
let pollTimer = null
const scanTipIndex = ref(0)
let scanTipTimer = null

function close() {
  show.value = false
  charPickerOpen.value = false
  batchRunning.value = false
  batchPaused.value = false
  batchCompleted.value = 0
  stopPolling()
  setTimeout(() => emit('close'), 180)
}

function charName(id) {
  return props.characters.find(c => c.id === id)?.display_name || `角色 #${id}`
}

const selectedCharacter = computed(() => props.characters.find(c => c.id === selectedCharId.value) || null)
const selectedCharacterName = computed(() => selectedCharacter.value?.display_name || selectedCharacter.value?.name || '请选择角色')
const selectedCountText = computed(() => selectedCharId.value === null
  ? '点击选择'
  : `${doneCount(selectedCharId.value)}/${emojiKeys.value.length}`)

function characterAvatarStyle(character) {
  return character?.avatar_path
    ? { backgroundImage: `url(${character.avatar_path})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {}
}

function selectCharacter(id) {
  selectedCharId.value = id
  charPickerOpen.value = false
}

function rowFor(charId, key) {
  return emojiRows.value.find(r => r.character_id === charId && r.emoji_key === key)
}

function isDone(charId, key) {
  const row = rowFor(charId, key)
  return row?.status === 'done' && !!row?.image_path
}
function isGenerating(charId, key) {
  return rowFor(charId, key)?.status === 'generating'
}
function isFailed(charId, key) {
  return rowFor(charId, key)?.status === 'failed'
}
function rowImage(charId, key) {
  return rowFor(charId, key)?.image_path || ''
}
function rowError(charId, key) {
  return rowFor(charId, key)?.error_message || ''
}
function doneCount(charId) {
  return emojiRows.value.filter(r => r.character_id === charId && r.status === 'done' && r.image_path).length
}
function isCharFull(charId) {
  return emojiKeys.value.length > 0 && doneCount(charId) >= emojiKeys.value.length
}
function charPercent(charId) {
  if (emojiKeys.value.length === 0) return 0
  return Math.min(100, Math.round((doneCount(charId) / emojiKeys.value.length) * 100))
}
function charGenerating(charId) {
  if (starting.value && selectedCharId.value === charId) return true
  if (promptPendingCharIds.value.includes(charId)) return true
  if (uploadingKey.value.startsWith(charId + ':')) return true
  return busyKey.value.startsWith(charId + ':') || emojiRows.value.some(r => r.character_id === charId && r.status === 'generating')
}

/** 卡片模糊层：单卡重生成/上传、图片生成中、或该角色 prompt 提炼中 */
function isCardLoading(charId, key) {
  if (busyKey.value === charId + ':' + key) return true
  if (uploadingKey.value === charId + ':' + key) return true
  if (isGenerating(charId, key)) return true
  return promptPendingCharIds.value.includes(charId)
}

const generatingRowsCount = computed(() => emojiRows.value.filter(r => r.status === 'generating').length)
const selectedGeneratingCount = computed(() => emojiRows.value.filter(r => r.character_id === selectedCharId.value && r.status === 'generating').length)
/** 当前角色是否已有提示词：决定工具栏显示「重新生成 + 完全重做」还是仅「完全重做」 */
const selectedCharHasPrompts = computed(() =>
  selectedCharId.value !== null &&
  emojiRows.value.some(r => r.character_id === selectedCharId.value && r.prompt)
)
const generating = computed(() => starting.value || busyKey.value !== '' || uploadingKey.value !== '' || deletingKey.value !== '' || generatingRowsCount.value > 0 || batchRunning.value)
const imageProgressVisible = computed(() => !starting.value && !batchRunning.value && (busyKey.value !== '' || generatingRowsCount.value > 0))
const batchCurrentName = computed(() => {
  const c = props.characters[batchIndex.value]
  return c?.display_name || c?.name || ''
})
const batchPhaseLabel = computed(() => {
  const charId = props.characters[batchIndex.value]?.id
  return promptPendingCharIds.value.includes(charId) ? '提炼表情脚本' : '生成表情图片'
})
const batchProgressText = computed(() => {
  const currentCharId = props.characters[batchIndex.value]?.id
  const currentStillRunning = currentCharId !== undefined && (
    promptPendingCharIds.value.includes(currentCharId) ||
    emojiRows.value.some(r => r.character_id === currentCharId && r.status === 'generating')
  )
  if (batchPaused.value) {
    if (currentStillRunning) return `已请求暂停，等待「${batchCurrentName.value}」完成…`
    return `已暂停 · 已完成 ${batchCompleted.value}/${props.characters.length} 个角色`
  }
  return `正在为「${batchCurrentName.value}」${batchPhaseLabel.value}（${batchIndex.value + 1}/${props.characters.length}）`
})
const imageProgressText = computed(() => {
  if (busyKey.value) return `正在重新生成「${busyKey.value.split(':')[1]}」...`
  const gen = selectedGeneratingCount.value
  if (gen > 0) {
    const done = doneCount(selectedCharId.value)
    return done > 0 ? `已生成 ${done} 张 · 还有 ${gen} 张仍在生成中` : `正在生成 ${gen} 张表情包...`
  }
  if (generatingRowsCount.value > 0) return `其他角色还有 ${generatingRowsCount.value} 张表情包正在生成中`
  return ''
})
const scanTips = [
  '正在为角色提炼表情脚本…',
  '正在翻阅角色档案与外观特征…',
  '正在推敲每个表情的镜头语言…',
  '正在校准 Q 版比例和线条…',
  '正在检查白色背景与留白…',
  '正在给表情加入一点小情绪…',
  '正在整理角色辨识度细节…',
  '正在把灵感写进提示词…',
]

async function loadOverview() {
  try {
    const d = await api.getEmojiOverview()
    emojiRows.value = d.emojis || []
    if (selectedCharId.value === null && d.characters?.length) {
      selectedCharId.value = d.characters[0].id
    }
  } catch (err) {
    toast?.('加载表情包数据失败: ' + err.message, 'error')
  }
}

async function loadCategories() {
  try {
    const d = await api.getEmojiCategories()
    emojiKeys.value = d.keys || []
    categoryDrafts.value = [...emojiKeys.value]
  } catch (err) {
    emojiKeys.value = []
    categoryDrafts.value = []
    toast?.('加载表情类别失败: ' + err.message, 'error')
  }
  try {
    const t = await api.getEmojiFixedTags()
    fixedTagsDraft.value = t.tags || ''
    styleMode.value = STYLE_MODE_ORDER.includes(t.styleMode) ? t.styleMode : 'half_body'
  } catch {
    fixedTagsDraft.value = ''
  }
}

async function toggleStyleMode() {
  if (styleModeSaving.value) return

  const previousMode = styleMode.value
  const nextMode = STYLE_MODE_ORDER[(STYLE_MODE_ORDER.indexOf(previousMode) + 1) % STYLE_MODE_ORDER.length]
  styleMode.value = nextMode
  styleModeSaving.value = true

  try {
    const t = await api.updateEmojiFixedTags(String(fixedTagsDraft.value || '').trim(), nextMode)
    if (t.error) throw new Error(t.error)
    fixedTagsDraft.value = t.tags || fixedTagsDraft.value
    styleMode.value = t.styleMode || nextMode
    toast?.(`表情包风格已切换为${STYLE_MODE_LABELS[styleMode.value] || nextMode}`, 'success')
  } catch (err) {
    styleMode.value = previousMode
    toast?.('切换表情包风格失败: ' + err.message, 'error')
  } finally {
    styleModeSaving.value = false
  }
}
/** 一键生成：先创造 prompt，再立即提交 ComfyUI 生成图片 */
async function generateAll() {
  if (selectedCharId.value === null || generating.value) return
  const charId = selectedCharId.value
  starting.value = true
  promptPendingCharIds.value.push(charId)
  try {
    await api.generateEmojiPrompts([charId], style.value.trim())
    promptPendingCharIds.value = promptPendingCharIds.value.filter(id => id !== charId)
    await api.generateEmojiImages([charId], [], artist.value)
    await loadOverview()
    if (generatingRowsCount.value > 0) startPolling()
    toast?.('表情包已开始生成', 'success')
  } catch (err) {
    toast?.('生成表情包失败: ' + err.message, 'error')
  } finally {
    starting.value = false
    promptPendingCharIds.value = promptPendingCharIds.value.filter(id => id !== charId)
  }
}

/** 重新生成：跳过提示词提炼，直接用现有提示词重画全部表情图片 */
async function regenerateAllImages() {
  if (selectedCharId.value === null || generating.value) return
  const charId = selectedCharId.value
  try {
    const d = await api.generateEmojiImages([charId], [], artist.value, true)
    if (d.error) throw new Error(d.error)
    await loadOverview()
    if (generatingRowsCount.value > 0) startPolling()
    if (d.count > 0) toast?.(`已开始重新生成 ${d.count} 张表情图片`, 'success')
    else toast?.('没有可重新生成的表情，请先「完全重做」提炼提示词', 'info')
  } catch (err) {
    toast?.('重新生成失败: ' + err.message, 'error')
  }
}

function openBatchDialog() {
  if (generating.value || props.characters.length === 0) return
  batchStyle.value = style.value
  showBatchDialog.value = true
}

/** 批量生成按钮（div）统一入口：先按原 disabled 条件守卫，再按运行状态继续/打开弹窗 */
function onBatchTrigger() {
  if (props.characters.length === 0 || (batchRunning.value && !batchPaused.value) || (!batchRunning.value && generating.value)) return
  if (batchRunning.value && batchPaused.value) resumeBatch()
  else openBatchDialog()
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function pauseBatch() {
  if (!batchRunning.value || batchPaused.value) return
  batchPaused.value = true
  toast?.('已暂停，当前角色完成后停止', 'info')
}

function resumeBatch() {
  if (!batchRunning.value || !batchPaused.value) return
  batchPaused.value = false
  toast?.('继续全部生成', 'success')
}

async function waitBatchResume() {
  while (batchRunning.value && batchPaused.value) await sleep(300)
}

/** 串行关键：等当前角色全部表情图落定（无 generating 行）再进入下一个角色；关闭弹窗可提前中止 */
async function waitForCharImages(charId) {
  while (batchRunning.value) {
    await loadOverview()
    if (!emojiRows.value.some(r => r.character_id === charId && r.status === 'generating')) return true
    await sleep(2000)
  }
  return false
}

/** 全部生成：严格串行——一个角色 prompt + 全部图片完成后，才开始下一个角色 */
async function startBatchGenerate() {
  if (batchRunning.value || generating.value) return
  const chars = [...props.characters]
  if (chars.length === 0) return
  showBatchDialog.value = false
  batchRunning.value = true
  batchPaused.value = false
  batchCompleted.value = 0
  const styleText = batchStyle.value.trim()
  let okCount = 0
  try {
    for (let i = 0; i < chars.length; i++) {
      if (!batchRunning.value) return
      if (batchPaused.value) {
        await waitBatchResume()
        if (!batchRunning.value) return
      }
      batchIndex.value = i
      const c = chars[i]
      const name = c.display_name || c.name || `角色 #${c.id}`
      try {
        promptPendingCharIds.value.push(c.id)
        const p = await api.generateEmojiPrompts([c.id], styleText)
        if (p?.error) throw new Error(p.error)
        promptPendingCharIds.value = promptPendingCharIds.value.filter(id => id !== c.id)
        if (batchPaused.value) {
          await waitBatchResume()
          if (!batchRunning.value) return
        }
        const g = await api.generateEmojiImages([c.id], [], artist.value)
        if (g?.error) throw new Error(g.error)
        if (batchPaused.value) {
          await waitBatchResume()
          if (!batchRunning.value) return
        }
        const finished = await waitForCharImages(c.id)
        if (!finished) return
        okCount++
        batchCompleted.value = okCount
      } catch (err) {
        promptPendingCharIds.value = promptPendingCharIds.value.filter(id => id !== c.id)
        toast?.(`「${name}」生成失败: ${err.message}`, 'error')
      }
      await loadOverview()
    }
    if (batchRunning.value && okCount > 0) {
      toast?.(`已为 ${okCount}/${chars.length} 个角色完成表情包生成`, 'success')
    }
  } finally {
    batchRunning.value = false
    batchPaused.value = false
    batchCompleted.value = 0
    promptPendingCharIds.value = []
  }
}

async function generateOneImage(charId, key) {
  if (batchRunning.value) return
  const row = rowFor(charId, key)
  if (!row?.prompt) {
    toast?.('请先生成 prompt', 'info')
    return
  }
  busyKey.value = charId + ':' + key
  try {
    const d = await api.regenerateEmojiImage(charId, key, artist.value)
    if (d.error) throw new Error(d.error)
    if (d.ok) toast?.(`「${key}」图片已生成`, 'success')
    else toast?.(d.error || '生成失败', 'error')
    await loadOverview()
  } catch (err) {
    toast?.('生成失败: ' + err.message, 'error')
  } finally {
    busyKey.value = ''
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

function openUpload(charId, key) {
  if (batchRunning.value || starting.value || busyKey.value || uploadingKey.value || isGenerating(charId, key)) return
  pendingUpload.value = { charId, key }
  uploadInputRef.value?.click()
}

async function onUploadFileChange(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  const target = pendingUpload.value
  pendingUpload.value = null
  if (!file || !target) return
  if (!/^image\/(png|jpeg|webp|gif|bmp)$/i.test(file.type)) {
    toast?.('请选择 PNG / JPG / WEBP / GIF / BMP 图片', 'error')
    return
  }
  if (file.size > 6 * 1024 * 1024) {
    toast?.('图片不能超过 6MB', 'error')
    return
  }
  let base64
  try {
    base64 = await readFileAsDataURL(file)
  } catch (err) {
    toast?.('读取图片失败: ' + err.message, 'error')
    return
  }
  const keyId = target.charId + ':' + target.key
  uploadingKey.value = keyId
  try {
    const d = await api.uploadEmojiImage(target.charId, target.key, base64)
    if (d.error) throw new Error(d.error)
    toast?.(`「${target.key}」图片已上传`, 'success')
    await loadOverview()
  } catch (err) {
    toast?.('上传失败: ' + err.message, 'error')
  } finally {
    uploadingKey.value = ''
  }
}

async function removeEmoji(charId, key) {
  const keyId = charId + ':' + key
  if (batchRunning.value || deletingKey.value || busyKey.value || uploadingKey.value) return
  const confirmed = confirmFn
    ? await confirmFn({ title: '清空表情图片', message: `确定清空「${key}」的图片吗？`, okText: '清空', danger: true })
    : window.confirm(`确定清空「${key}」的图片吗？`)
  if (!confirmed) return
  deletingKey.value = keyId
  try {
    const d = await api.deleteEmoji(charId, key)
    if (d.error) throw new Error(d.error)
    await loadOverview()
    toast?.(`「${key}」图片已清空`, 'success')
  } catch (err) {
    toast?.('删除失败: ' + err.message, 'error')
  } finally {
    deletingKey.value = ''
  }
}

async function saveAdvancedSettings() {
  const keys = categoryDrafts.value.map(k => String(k || '').trim())
  const tagsText = String(fixedTagsDraft.value || '').trim()
  categoryError.value = ''
  fixedTagsError.value = ''
  if (keys.length !== 15 || keys.some(k => !k)) {
    categoryError.value = '表情类别固定为 15 个，且名称不能为空'
    return
  }
  if (!tagsText) {
    fixedTagsError.value = '固定 tag 不能为空'
    return
  }
  categorySaving.value = true
  try {
    const d = await api.updateEmojiCategories(keys)
    if (d.error) throw new Error(d.error)
    emojiKeys.value = d.keys || []
    categoryDrafts.value = [...emojiKeys.value]
    const t = await api.updateEmojiFixedTags(tagsText, styleMode.value)
    if (t.error) throw new Error(t.error)
    fixedTagsDraft.value = t.tags || tagsText
    if (t.styleMode) styleMode.value = t.styleMode
    showAdvancedSettings.value = false
    toast?.('高级设置已保存', 'success')
  } catch (err) {
    categoryError.value = err.message
    toast?.('保存失败: ' + err.message, 'error')
  } finally {
    categorySaving.value = false
  }
}

function startScanTips() {
  if (scanTipTimer) return
  scanTipIndex.value = 0
  let idx = 0
  scanTipTimer = setInterval(() => {
    idx = (idx + 1) % scanTips.length
    scanTipIndex.value = idx
  }, 2200)
}

function stopScanTips() {
  if (scanTipTimer) {
    clearInterval(scanTipTimer)
    scanTipTimer = null
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    await loadOverview()
    if (generatingRowsCount.value === 0) stopPolling()
  }, 2500)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

watch(starting, (active) => {
  if (active) startScanTips()
  else stopScanTips()
}, { immediate: true })

watch(isMobile, (mobile) => {
  if (!mobile) charPickerOpen.value = false
})

onMounted(async () => {
  if (props.characters.length > 0) selectedCharId.value = props.characters[0].id
  loadCategories()
  await loadOverview()
  if (generatingRowsCount.value > 0) startPolling()
})

onBeforeUnmount(() => {
  batchRunning.value = false
  batchPaused.value = false
  batchCompleted.value = 0
  stopPolling()
  stopScanTips()
})
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
}
.modal-panel {
  background: #f4f1eeed;
  border-radius: 18px;
  width: min(880px, 96vw); max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}
.modal-wide { width: min(1100px, 97vw); }
.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 22px;
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
}
.modal-header h3 { font-size: 17px; font-weight: 600; color: var(--text-bright); }
.modal-close {
  width: 30px; height: 30px; border-radius: 50%;
  flex-shrink: 0;
  box-sizing: border-box;
  border: none; background: var(--glass-bg-strong);
  color: var(--text-secondary); font-size: 15px;
  font-family: inherit; line-height: 1;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  user-select: none;
  transition: all 0.15s;
}
.modal-close:hover { background: var(--bg-hover); color: var(--text-bright); }
.modal-close:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.modal-fade-enter-active { transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.modal-fade-leave-active { transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-active .modal-panel { animation: emoji-modal-pop 0.28s cubic-bezier(0.17, 0.89, 0.32, 1.25); }
@keyframes emoji-modal-pop {
  0% { transform: scale(0.92); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

.emoji-manager-modal {
  width: min(1287px, 94vw);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}
.emoji-body {
  flex: 1;
  position: relative;
  display: flex;
  gap: 16px;
  padding: 16px 20px 20px;
  overflow: hidden;
  background: var(--glass-bg);
  border-radius: 14px;
  margin: 0 20px 20px;
}

/* ── 生成 prompt 时全局扫描遮罩（招募同款）── */
.emoji-gen-overlay {
  position: absolute; inset: 0; z-index: 20;
  background: rgba(255, 255, 255, 0.55);
  border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.emoji-gen-line {
  position: absolute; left: 12%; right: 12%; height: 2px;
  background: linear-gradient(90deg, transparent, rgba(224,123,108,0.3), var(--accent), rgba(224,123,108,0.3), transparent);
  animation: emoji-gen-sweep 2.2s ease-in-out infinite;
  box-shadow: 0 0 26px rgba(224,123,108,0.55), 0 0 8px rgba(224,123,108,0.25);
  z-index: 2; pointer-events: none;
}
@keyframes emoji-gen-sweep {
  0%   { top: 8%; opacity: 0.15; }
  25%  { top: 92%; opacity: 1; }
  50%  { top: 92%; opacity: 0.15; }
  75%  { top: 8%; opacity: 1; }
  100% { top: 8%; opacity: 0.15; }
}
.emoji-gen-glow {
  position: absolute; left: 20%; right: 20%; height: 70px;
  background: radial-gradient(ellipse at center, rgba(224,123,108,0.13) 0%, rgba(224,123,108,0.04) 40%, transparent 70%);
  animation: emoji-gen-glow-follow 2.2s ease-in-out infinite;
  z-index: 1; pointer-events: none; filter: blur(8px);
}
@keyframes emoji-gen-glow-follow {
  0%   { top: 6%; opacity: 0.2; }
  25%  { top: 72%; opacity: 0.9; }
  50%  { top: 72%; opacity: 0.2; }
  75%  { top: 6%; opacity: 0.9; }
  100% { top: 6%; opacity: 0.2; }
}
.emoji-gen-content {
  position: relative; z-index: 3;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 24px 20px; text-align: center;
}
.emoji-gen-label {
  font-size: 14px; font-weight: 700; color: var(--accent);
  animation: emoji-gen-label-pulse 1.4s ease-in-out infinite;
}
@keyframes emoji-gen-label-pulse {
  0%, 100% { opacity: 0.5; }
  50%      { opacity: 1; }
}
.emoji-gen-phrase {
  position: relative; min-height: 22px; width: 100%;
  display: flex; align-items: center; justify-content: center;
}
.emoji-gen-phrase p {
  margin: 0; font-size: 0.85rem; color: var(--text-secondary); white-space: nowrap;
}
.emoji-gen-phrase-enter-active, .emoji-gen-phrase-leave-active {
  transition: all 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}
.emoji-gen-phrase-leave-to {
  transform: translateY(-14px); opacity: 0;
}
.emoji-gen-phrase-enter-from {
  transform: translateY(14px); opacity: 0;
}
.emoji-left {
  width: 230px;
  flex-shrink: 0;
  border-right: 1px solid var(--glass-border);
  padding: 0 12px 0 4px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.emoji-left-title {
  order: -1;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 10px;
}
.emoji-char-picker { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.emoji-char-layer { flex: 1; min-width: 0; min-height: 0; display: flex; }
.emoji-char-dropdown { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.emoji-char-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 2px 6px 4px 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.15) transparent;
}
.emoji-char-list::-webkit-scrollbar { width: 4px; height: 4px; }
.emoji-char-list::-webkit-scrollbar-track { background: transparent; }
.emoji-char-list::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.14);
  border-radius: 4px;
}
.emoji-char-list::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.26); }
.emoji-char-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
}
.emoji-char-item:hover { background: rgba(0, 0, 0, 0.04); }
.emoji-char-item.active {
  background: rgba(224, 123, 108, 0.12);
  border-color: var(--accent);
}
.emoji-char-avatar {
  width: 40px; height: 40px; border-radius: 50%;
  background: #e07b6c;
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 600;
  flex-shrink: 0;
  background-size: cover;
  background-position: center;
}
.emoji-char-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-bright);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.emoji-char-meta { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.emoji-char-count {
  min-height: 20px;
  min-width: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 2px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.emoji-count-num {
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
  color: var(--text-bright);
}
.emoji-count-total {
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  color: var(--text-secondary);
}
.emoji-char-count.full .emoji-count-num { color: var(--accent); }
.emoji-char-count.full .emoji-count-total { color: rgba(224, 123, 108, 0.72); }
.emoji-full-icon {
  margin-left: 25px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--accent);
}
.emoji-full-icon svg {
  width: 25px;
  height: 25px;
  display: block;
}
.emoji-gen-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-right: 3px;
  padding: 2px 7px 2px 5px;
  border-radius: 999px;
  background: rgba(224, 123, 108, 0.1);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  animation: emoji-gen-badge-pulse 1.5s ease-in-out infinite;
}
@keyframes emoji-gen-badge-pulse {
  0%, 100% { box-shadow: 0 0 0 1px rgba(224, 123, 108, 0.12), 0 0 0 0 rgba(224, 123, 108, 0); }
  50% { box-shadow: 0 0 0 1px rgba(224, 123, 108, 0.34), 0 0 12px rgba(224, 123, 108, 0.28); }
}
.emoji-char-progress {
  height: 3px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.06);
  overflow: hidden;
  margin-top: 2px;
}
.emoji-char-progress i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: rgba(224, 123, 108, 0.42);
  transition: width 0.25s ease;
}
.emoji-char-progress.full i { background: var(--accent); }
.emoji-char-progress.generating i { animation: emoji-progress-pulse 1.2s ease-in-out infinite; }
@keyframes emoji-progress-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}
.emoji-batch-row {
  margin-top: 10px;
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.emoji-batch-btn {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border-radius: 10px;
  border: 1px dashed rgba(224, 123, 108, 0.35);
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.15s;
  user-select: none;
}
.emoji-batch-btn:hover:not(.is-disabled) {
  border-style: solid;
  border-color: var(--accent);
  background: rgba(224, 123, 108, 0.08);
}
.emoji-batch-btn.paused {
  border-style: solid;
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
.emoji-batch-btn.paused:hover:not(.is-disabled) { background: var(--accent-hover); }
.emoji-batch-btn.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.emoji-batch-spinner {
  width: 12px;
  height: 12px;
  border-width: 2px;
}
.emoji-pause-btn {
  width: 34px;
  height: 34px;
  padding: 0;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  border: 1px solid rgba(224, 123, 108, 0.35);
  background: rgba(224, 123, 108, 0.08);
  color: var(--accent);
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}
.emoji-pause-btn:hover {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  box-shadow: 0 2px 10px rgba(224, 123, 108, 0.25);
}

.emoji-right {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.emoji-toolbar-row {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  background: #fff;
  padding: 10px 14px;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}
.emoji-gear {
  width: 30px; height: 30px;
  padding: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 50%;
  color: var(--text-secondary);
  cursor: pointer;
  line-height: 1;
  flex-shrink: 0;
  font-size: 17px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s ease;
  user-select: none;
}
.emoji-gear:hover {
  color: var(--accent);
  border-color: var(--accent);
  transform: rotate(60deg);
}
.emoji-mode-badge {
  flex-shrink: 0;
  cursor: pointer;
  border: none;
  font-family: inherit;
  transition: opacity 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
  padding: 7px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  user-select: none;
}
.emoji-mode-badge.half_body { background: #FBEAE6; color: #D96A59; }
.emoji-mode-badge.half_body_chibi { background: #FBF2DD; color: #B8873B; }
.emoji-mode-badge.chibi_head { background: #E8F1EA; color: #5B8C6E; }
.emoji-mode-badge:hover:not(.is-disabled) {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(125, 105, 85, 0.12);
}
.emoji-mode-badge:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.emoji-style-input {
  flex: 1;
  min-width: 240px;
  padding: 9px 12px;
}
.emoji-progress-strip {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(224, 123, 108, 0.08);
  border: 1px solid rgba(224, 123, 108, 0.16);
  color: var(--accent); font-size: 13px; font-weight: 600;
}
.emoji-progress-strip.paused {
  background: rgba(224, 123, 108, 0.05);
  border-color: rgba(224, 123, 108, 0.14);
  color: var(--text-secondary);
}
.emoji-paused-mark {
  position: relative;
  width: 14px;
  height: 14px;
  border-radius: 4px;
  background: var(--accent);
  flex-shrink: 0;
}
.emoji-paused-mark::before,
.emoji-paused-mark::after {
  content: '';
  position: absolute;
  top: 3px;
  bottom: 3px;
  width: 2px;
  border-radius: 1px;
  background: #fff;
}
.emoji-paused-mark::before { left: 4px; }
.emoji-paused-mark::after { right: 4px; }
.emoji-spinner {
  display: inline-block; flex-shrink: 0;
  width: 14px; height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(224, 123, 108, 0.22);
  border-top-color: var(--accent);
  animation: emoji-spin 0.8s linear infinite;
}
@keyframes emoji-spin {
  to { transform: rotate(360deg); }
}
.emoji-gen-badge .emoji-count-spinner {
  width: 12px; height: 12px; border-width: 2px;
  box-shadow: 0 0 8px rgba(224, 123, 108, 0.4);
}
.emoji-scan-overlay .emoji-spinner {
  width: 22px; height: 22px; border-width: 2.5px;
}
.emoji-progress-label {
  min-width: 0;
}
.emoji-empty {
  padding: 32px;
  text-align: center;
  color: var(--text-secondary);
}
.emoji-char-section {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  padding: 4px 4px 4px 0;
}
.emoji-char-section::-webkit-scrollbar { display: none; }
.emoji-char-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
  color: var(--text-bright);
}
.emoji-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  padding-left: 5px;
}
.emoji-reveal-enter-active {
  transition: opacity 0.55s ease, transform 0.45s cubic-bezier(0.2, 0.7, 0.3, 1);
}
.emoji-reveal-enter-from {
  opacity: 0; transform: translateY(10px) scale(0.97);
}
.emoji-reveal-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.emoji-reveal-leave-to {
  opacity: 0; transform: scale(0.97);
}
.emoji-card {
  position: relative;
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.3);
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
}
.emoji-card.generating {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.emoji-card.failed { border-color: #e06b6b; }
.emoji-card.empty {
  border-style: dashed;
  border-color: rgba(224, 123, 108, 0.28);
  cursor: pointer;
}
.emoji-card.empty:hover {
  border-color: var(--accent);
}
.emoji-card-delete {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 4;
  width: 26px;
  height: 26px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(224, 123, 108, 0.38);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  color: #e07b6c;
  cursor: pointer;
  opacity: 0;
  transform: translateY(-3px);
  transition: opacity 0.16s ease, transform 0.16s ease, background 0.16s ease, border-color 0.16s ease, color 0.16s ease;
  user-select: none;
}
.emoji-card:hover .emoji-card-delete {
  opacity: 1;
  transform: translateY(0);
}
.emoji-card-delete:hover:not(.is-disabled) {
  background: #e07b6c;
  border-color: #e07b6c;
  color: #fff;
}
.emoji-card-delete.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.emoji-card.generating.empty {
  border-style: solid; cursor: default;
}
.emoji-card.generating .emoji-empty-slot { cursor: default; }
.emoji-empty-slot {
  width: 100%; aspect-ratio: 1;
  border-radius: 8px;
  background: rgba(224, 123, 108, 0.04);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background 0.15s;
}
.emoji-empty-slot:hover { background: rgba(224, 123, 108, 0.1); }
.emoji-empty-plus {
  font-size: 34px; line-height: 1;
  color: var(--accent-light);
}
.emoji-empty-slot .emoji-spinner {
  width: 22px; height: 22px; border-width: 2.5px;
}
.emoji-card-head {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.emoji-key { font-weight: 600; }
.emoji-image-wrap {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background: #f4f4f4;
  display: flex;
  align-items: center;
  justify-content: center;
}
.emoji-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.emoji-image-placeholder {
  color: var(--accent-light);
  font-size: 28px;
  line-height: 1;
}
.emoji-card-actions {
  display: flex;
  gap: 6px;
}
.emoji-card-actions .btn-sm {
  flex: 1;
}
.emoji-error {
  font-size: 11px;
  color: #c0392b;
}
.emoji-scan-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.68);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  overflow: hidden;
  pointer-events: none;
}

.advanced-overlay {
  z-index: 10001;
}
.advanced-panel {
  width: min(560px, 94vw);
}
.batch-panel {
  width: min(460px, 94vw);
}
.advanced-body {
  padding: 0px 24px;
  overflow-y: auto;
  flex: 1;
}
.advanced-section {
  margin-bottom: 0;
}
.advanced-content {
  background: #FFFFFF;
  border-radius: 14px;
  padding: 18px;
  box-shadow: 0 4px 18px rgba(72, 55, 44, 0.05);
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.advanced-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-bright);
  margin-bottom: 8px;
}
.advanced-artist-input {
  width: 100%;
  padding: 9px 12px;
}
.advanced-tags-input {
  width: 100%;
  padding: 9px 12px;
  word-break: break-all;
}
.emoji-style-segmented {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 3px;
  background: #F7F2EC;
  border-radius: 10px;
}
.emoji-style-chip {
  padding: 8px 6px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #6F675F;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
  text-align: center;
  white-space: nowrap;
  user-select: none;
}
.emoji-style-chip:hover { color: #E07B6C; }
.emoji-style-chip.active {
  background: #FFFEFC;
  color: #E07B6C;
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(125, 105, 85, 0.12);
}
.advanced-hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 6px;
}
.advanced-cat-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px 10px;
}
.advanced-cat-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.advanced-cat-index {
  width: 22px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 12px;
  flex-shrink: 0;
}
.advanced-cat-input {
  flex: 1;
  min-width: 0;
  width: 100%;
  padding: 7px 8px;
}
.advanced-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px;
  border-top: 1px solid rgba(42, 26, 16, 0.07);
}
@media (max-width: 767px) {
  .advanced-body { padding: 16px; }
  .advanced-content { padding: 16px; border-radius: 12px; }
  .advanced-cat-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .advanced-footer { padding: 14px 16px; }
  .emoji-body { flex-direction: column; }
  .emoji-left { width: 100%; border-right: none; border-bottom: 1px solid var(--glass-border); padding-bottom: 10px; }
  .emoji-char-list { flex-direction: row; overflow-x: auto; }
  .emoji-char-item { flex-shrink: 0; width: 100%; box-sizing: border-box; }
  .emoji-char-meta { flex: 1; width: 100%; }

  .modal-overlay { align-items: flex-start; }
  .emoji-manager-modal {
    width: 100%;
    height: 100vh;
    height: 100dvh;
    max-height: none;
    background: #f4f1ee;
    border-radius: 0;
  }
  .modal-header {
    padding: calc(8px + env(safe-area-inset-top, 0px)) 14px 8px;
  }
  .modal-header h3 { font-size: 16px; }
  .emoji-body {
    gap: 8px;
    margin: 0;
    padding: 6px 12px calc(10px + env(safe-area-inset-bottom, 0px));
    border-radius: 0;
  }
  .emoji-left {
    width: 100%;
    border-right: none;
    padding: 0;
    flex: 0 0 auto;
  }
  .emoji-left-title { display: none; }
  .emoji-char-picker { display: block; flex: 0 0 auto; }
  .emoji-char-trigger {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px;
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.72);
    color: var(--text-bright);
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    user-select: none;
  }
  .emoji-char-trigger-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .emoji-char-trigger-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .emoji-char-trigger-count { font-size: 11px; font-weight: 600; color: var(--text-secondary); }
  .emoji-char-trigger-chevron { color: var(--text-secondary); transition: transform 0.2s ease; }
  .emoji-char-trigger-chevron.open { transform: rotate(180deg); color: var(--accent); }
  .emoji-char-layer.open {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: block;
  }
  .emoji-picker-scrim {
    position: absolute;
    inset: 0;
    padding: 0;
    border: 0;
    background: rgba(43, 31, 24, 0.24);
    cursor: default;
  }
  .emoji-char-dropdown {
    position: absolute;
    top: calc(90px + env(safe-area-inset-top, 0px));
    left: 0;
    right: 0;
    padding: 10px;
    max-height: min(72dvh, 540px);
    overflow: hidden;
    border-radius: 14px;
    background: #fff;
    border: 1px solid var(--glass-border);
    box-shadow: 0 10px 32px rgba(72, 55, 44, 0.18);
  }
  .emoji-dropdown-head { padding: 10px 12px 6px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
  .emoji-char-list {
    flex-direction: column;
    overflow-y: auto;
    padding: 2px 4px 6px;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    touch-action: pan-y;
  }
  .emoji-char-item { transition: none; }
  .emoji-batch-row { margin-top: 8px; flex: 0 0 auto; }
  .emoji-batch-btn { padding: 8px 10px; font-size: 12px; }
  .emoji-toolbar-row {
    flex-wrap: nowrap;
    gap: 6px;
    padding: 6px;
    border-radius: 10px;
    box-shadow: 0 1px 5px rgba(72, 55, 44, 0.06);
  }
  .emoji-gear { width: 32px; height: 32px; }
  .emoji-mode-badge { padding: 8px 8px; font-size: 11px; }
  .emoji-style-input { flex: 1; min-width: 0; padding: 8px 10px; font-size: 12px; }
  .emoji-toolbar-row .emoji-redo-btn { flex: 0 0 auto; }
  .emoji-progress-strip { padding: 6px 10px; font-size: 12px; }
  .emoji-char-section {
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    touch-action: pan-y;
  }
  .emoji-card {
    contain: content;
    content-visibility: auto;
    contain-intrinsic-size: auto 220px;
  }
  .emoji-grid { grid-template-columns: repeat(auto-fill, minmax(126px, 1fr)); gap: 8px; padding-left: 0; }
  .emoji-char-title { display: none; }
  .emoji-card { padding: 8px; border-radius: 10px; gap: 6px; }
  .emoji-card-delete { opacity: 1; transform: none; }
  .emoji-card-actions { flex-wrap: nowrap; }
  .emoji-card-actions .btn-sm {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .emoji-picker-fade-enter-active,
  .emoji-picker-fade-leave-active { transition: opacity 0.18s ease; }
  .emoji-picker-fade-enter-from,
  .emoji-picker-fade-leave-to { opacity: 0; }
  .emoji-picker-fade-enter-active .emoji-char-dropdown,
  .emoji-picker-fade-leave-active .emoji-char-dropdown { transition: transform 0.18s ease; }
  .emoji-picker-fade-enter-from .emoji-char-dropdown,
  .emoji-picker-fade-leave-to .emoji-char-dropdown { transform: translateY(-6px); }

  @media (prefers-reduced-motion: reduce) {
    .emoji-picker-fade-enter-active,
    .emoji-picker-fade-leave-active,
    .emoji-picker-fade-enter-active .emoji-char-dropdown,
    .emoji-picker-fade-leave-active .emoji-char-dropdown { transition: none; }
  }
}
</style>
