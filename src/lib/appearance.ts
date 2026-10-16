export const palettes=[{id:'monochrome',name:'苹果无彩色',color:'#4b4b4f'},{id:'violet',name:'鸢尾紫',color:'#7265ca'},{id:'blue',name:'海洋蓝',color:'#246cc4'},{id:'teal',name:'松石绿',color:'#267d73'},{id:'rose',name:'玫瑰红',color:'#ac526a'},{id:'graphite',name:'石墨灰',color:'#616b7c'}] as const;
export type Palette=typeof palettes[number]['id'];
